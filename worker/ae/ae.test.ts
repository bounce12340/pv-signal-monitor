// worker/ae.js 的純函式測試。
//
// 重點不是「函式會不會跑」，而是**前後端兩份判定邏輯必須一致**：
// worker/ae.js 為了寫入 D1 的索引欄位，重寫了一份「是否嚴重」與「法定期限」的計算，
// 這是刻意的鏡像（Worker 不能匯入 TypeScript 的前端模組）。鏡像會漂移，
// 所以這裡用同一批個案同時餵給兩邊，逐案比對結果。
import { describe, it, expect } from 'vitest';
// 直接匯入 Worker 的原始 .js（tsconfig 已開 allowJs），不另做包裝——
// 包裝層本身就會成為第二個可能與部署版本不同步的地方。
import {
  deriveSerious, deriveDueDate, indexColumns, parseIsoDate, addDays,
  normalizeEmail, normalizeRole, bootstrapRole, canReadCase, canRepOverwrite,
  sanitizeProfile, isProfileComplete, rowToProfile, PROFILE_FIELDS,
} from './ae.js';
import {
  emptyAEReport, emptyEvent, emptyDrug,
  assessSeriousness, computeRegulatoryClock, AEReport,
} from '../../services/ae/aeReport';

const TODAY = '2026-09-08';

function caseOf(over: Partial<AEReport> = {}): AEReport {
  return {
    ...emptyAEReport(TODAY),
    caseNumber: 'PV-2026-0001',
    awarenessDate: '2026-09-01',
    patientInitials: 'W.T.M.',
    events: [{ ...emptyEvent(), id: 'ev1', verbatim: '紅疹' }],
    drugs: [{ ...emptyDrug(true), id: 'dr1', brandName: 'Lipanthyl', activeIngredient: 'Fenofibrate' }],
    ...over,
  };
}

const serious = (over: Partial<AEReport> = {}) => caseOf({
  events: [{ ...emptyEvent(), id: 'ev1', verbatim: '住院', seriousnessCriteria: ['hospitalization'] }],
  ...over,
});

describe('worker 日期工具', () => {
  it('parseIsoDate 與前端同樣拒絕溢位與非法格式', () => {
    expect(parseIsoDate('2026-09-08')?.toISOString().slice(0, 10)).toBe('2026-09-08');
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026/09/08')).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });
  it('addDays 跨年正確；無效輸入回 null（前端回空字串，此處要落成 SQL NULL）', () => {
    expect(addDays('2026-12-25', 15)).toBe('2027-01-09');
    expect(addDays('bad', 15)).toBeNull();
  });
});

describe('worker 與前端的嚴重性／時鐘判定必須一致', () => {
  // 每個案例都涵蓋一條分支：無嚴重度、有嚴重度、人工判嚴重、人工判非嚴重、
  // 追蹤報告有無重要新資訊、缺 Day 0。
  const fixtures: Array<[string, AEReport]> = [
    ['非嚴重個案', caseOf()],
    ['住院 → 嚴重', serious()],
    ['人工覆寫為嚴重', caseOf({ triage: { ...emptyAEReport(TODAY).triage, seriousnessOverride: 'serious' } })],
    ['人工覆寫為非嚴重', serious({ triage: { ...emptyAEReport(TODAY).triage, seriousnessOverride: 'non_serious' } })],
    ['追蹤報告帶重要新資訊 → 重啟時鐘', serious({ reportType: 'follow_up', hasSignificantNewInfo: true, awarenessDate: '2026-09-05' })],
    ['追蹤報告純補件 → 不重啟時鐘', serious({ reportType: 'follow_up', hasSignificantNewInfo: false })],
    ['嚴重但缺 Day 0', serious({ awarenessDate: '' })],
    ['多事件僅其一嚴重', caseOf({
      events: [
        { ...emptyEvent(), id: 'e1', verbatim: '頭暈' },
        { ...emptyEvent(), id: 'e2', verbatim: '過敏性休克', seriousnessCriteria: ['life_threatening'] },
      ],
    })],
  ];

  for (const [name, report] of fixtures) {
    it(name, () => {
      const clock = computeRegulatoryClock(report, TODAY);
      expect(deriveSerious(report)).toBe(assessSeriousness(report).serious);
      // 前端沒有期限時回空字串，Worker 回 null（SQL 欄位要 NULL）——語意相同。
      expect(deriveDueDate(report) || '').toBe(clock.dueDate);
    });
  }
});

describe('indexColumns', () => {
  it('取首個 suspect 藥品，並把病人代號正規化為比對用鍵', () => {
    const r = caseOf({
      country: 'JP',
      patientInitials: '  W.T.M. ',
      drugs: [
        { ...emptyDrug(false), id: 'd0', brandName: 'Concomitant' },
        { ...emptyDrug(true), id: 'd1', brandName: 'Lipanthyl', activeIngredient: 'Fenofibrate' },
      ],
    });
    const cols = indexColumns(r);
    expect(cols.suspect_drug).toBe('Lipanthyl');
    expect(cols.patient_key).toBe('w.t.m.');
    expect(cols.country).toBe('JP');
    expect(cols.report_type).toBe('initial');
    expect(cols.serious).toBe(0);
    expect(cols.due_date).toBeNull();
  });

  it('無 brandName 時退回成分名', () => {
    const r = caseOf({ drugs: [{ ...emptyDrug(true), id: 'd1', brandName: '', activeIngredient: 'Fenofibrate' }] });
    expect(indexColumns(r).suspect_drug).toBe('Fenofibrate');
  });

  it('嚴重個案寫入到期日，並沿用 payload 的狀態', () => {
    const cols = indexColumns(serious({ status: 'submitted' }));
    expect(cols.serious).toBe(1);
    expect(cols.due_date).toBe('2026-09-16');
    expect(cols.status).toBe('submitted');
  });

  it('payload 沒帶狀態時預設為 submitted——能進到後端就代表已送出', () => {
    expect(indexColumns(caseOf({ status: '' as any })).status).toBe('submitted');
    expect(indexColumns({} as AEReport).status).toBe('submitted');
  });

  it('空白欄位一律落成 NULL 而非空字串（空字串在 SQL 的比對語意不同）', () => {
    const cols = indexColumns({} as AEReport);
    expect(cols.country).toBeNull();
    expect(cols.patient_key).toBeNull();
    expect(cols.suspect_drug).toBeNull();
    expect(cols.awareness_date).toBeNull();
    expect(cols.follow_up_of_id).toBeNull();
  });

  it('追蹤報告保留父案 id', () => {
    const cols = indexColumns(caseOf({ reportType: 'follow_up', followUpOfId: 'root-1' }));
    expect(cols.report_type).toBe('follow_up');
    expect(cols.follow_up_of_id).toBe('root-1');
  });
});

// ─────────────────────────────────────────────────────────────
// 權限
//
// 這一組測試的價值不在覆蓋率，而在於它們描述的是**外洩的形狀**：
// 每一條失敗都對應「某個業務讀到了別人通報的病人資料」。
// 因此每條規則都連同它的反面一起測，不只測 happy path。
// ─────────────────────────────────────────────────────────────

describe('normalizeRole：任何無法辨識的值都降級為 rep', () => {
  it('只有明確的 pv 才是 pv', () => {
    expect(normalizeRole('pv')).toBe('pv');
    expect(normalizeRole('PV')).toBe('pv');
    expect(normalizeRole(' pv ')).toBe('pv');
  });
  it('null／空值／拼錯／可疑輸入一律 rep', () => {
    for (const v of [null, undefined, '', 'rep', 'admin', 'pv_', 'p v', 'PVX', 0, {}, []]) {
      expect(normalizeRole(v as any)).toBe('rep');
    }
  });
});

describe('normalizeEmail', () => {
  it('去空白並轉小寫——JWT 的大小寫不保證與資料表一致', () => {
    expect(normalizeEmail('  Alice@Company.COM ')).toBe('alice@company.com');
    expect(normalizeEmail(null)).toBe('');
  });
});

describe('bootstrapRole：開機用的藥安人員清單', () => {
  const LIST = 'alice@company.com, Bob@Company.com ,';
  it('清單內的人是 pv，大小寫與空白不影響', () => {
    expect(bootstrapRole('alice@company.com', LIST)).toBe('pv');
    expect(bootstrapRole('BOB@company.com', LIST)).toBe('pv');
  });
  it('清單外的人回 null（交給資料表決定，而非直接給權限）', () => {
    expect(bootstrapRole('carol@company.com', LIST)).toBeNull();
  });
  it('空清單、空 email 都不給權限——設定漏了不能變成人人是 pv', () => {
    expect(bootstrapRole('alice@company.com', '')).toBeNull();
    expect(bootstrapRole('alice@company.com', undefined)).toBeNull();
    expect(bootstrapRole('', LIST)).toBeNull();
    expect(bootstrapRole('', ',,,')).toBeNull();
  });
});

describe('canReadCase：業務只讀得到自己送的個案', () => {
  const mine = { submitted_by: 'rep@company.com', status: 'submitted' };
  const theirs = { submitted_by: 'other@company.com', status: 'submitted' };

  it('pv 讀得到任何個案', () => {
    expect(canReadCase('pv', 'pv@company.com', mine)).toBe(true);
    expect(canReadCase('pv', 'pv@company.com', theirs)).toBe(true);
  });
  it('rep 讀得到自己的', () => {
    expect(canReadCase('rep', 'rep@company.com', mine)).toBe(true);
    expect(canReadCase('rep', 'REP@Company.com', mine)).toBe(true); // 大小寫不同仍是同一人
  });
  it('rep 讀不到別人的', () => {
    expect(canReadCase('rep', 'rep@company.com', theirs)).toBe(false);
  });
  it('個案不存在時回 false，不是回 true', () => {
    expect(canReadCase('rep', 'rep@company.com', null)).toBe(false);
    expect(canReadCase('rep', 'rep@company.com', undefined)).toBe(false);
  });
  it('空值不算相符——否則「沒有 actor」會對上「沒有 submitted_by」而放行', () => {
    expect(canReadCase('rep', 'rep@company.com', { status: 'submitted' })).toBe(false);
    expect(canReadCase('rep', '', { submitted_by: '', status: 'submitted' })).toBe(false);
    expect(canReadCase('rep', '', mine)).toBe(false);
    expect(canRepOverwrite('', { submitted_by: '', status: 'submitted' })).toBe(false);
  });
});

describe('canRepOverwrite：離線補送要成功，但不能洗掉藥安的處理', () => {
  it('個案不存在＝新增，放行', () => {
    expect(canRepOverwrite('rep@company.com', null)).toBe(true);
  });
  it('自己送的、藥安還沒動過（submitted／draft）→ 放行，讓 outbox 補送成功', () => {
    expect(canRepOverwrite('rep@company.com', { submitted_by: 'rep@company.com', status: 'submitted' })).toBe(true);
    expect(canRepOverwrite('rep@company.com', { submitted_by: 'rep@company.com', status: 'draft' })).toBe(true);
  });
  it('藥安已開始處理 → 擋下，否則業務按一下重送就把判定與編碼洗掉', () => {
    for (const status of ['triage', 'coded', 'ready', 'reported', 'closed', 'invalid', 'follow_up']) {
      expect(canRepOverwrite('rep@company.com', { submitted_by: 'rep@company.com', status })).toBe(false);
    }
  });
  it('別人送的個案一律擋下，即使狀態還是 submitted', () => {
    expect(canRepOverwrite('rep@company.com', { submitted_by: 'other@company.com', status: 'submitted' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 通報者個人檔案
// ─────────────────────────────────────────────────────────────

describe('sanitizeProfile：白名單，使用者不能靠建檔給自己升權', () => {
  it('只留下白名單欄位', () => {
    const out = sanitizeProfile({
      display_name: '林小明', phone: '0912345678', employee_id: 'A123',
      contact_email: 'ming@company.com', org: '天義', territory: '北區',
    });
    expect(Object.keys(out).sort()).toEqual([...PROFILE_FIELDS].sort());
    expect(out.display_name).toBe('林小明');
  });

  it('role 一概丟棄——這是整個檔案功能唯一會出事的地方', () => {
    const out = sanitizeProfile({ display_name: '林小明', role: 'pv' });
    expect(out).not.toHaveProperty('role');
    expect(Object.keys(out)).toEqual(['display_name']);
  });

  it('email、created_at 等伺服器欄位同樣丟棄', () => {
    const out = sanitizeProfile({
      display_name: '林小明', email: 'other@company.com',
      created_at: '2000-01-01', created_by: 'someone', updated_at: 'x',
    });
    expect(Object.keys(out)).toEqual(['display_name']);
  });

  it('未提供的欄位不出現在結果裡（代表不更動，而非清空）', () => {
    const out = sanitizeProfile({ phone: '0912345678' });
    expect(Object.keys(out)).toEqual(['phone']);
    expect(out).not.toHaveProperty('display_name');
  });

  it('修剪空白並限制長度，非字串一律轉成字串', () => {
    expect(sanitizeProfile({ display_name: '  林小明  ' }).display_name).toBe('林小明');
    expect(sanitizeProfile({ phone: 'x'.repeat(500) }).phone).toHaveLength(200);
    expect(sanitizeProfile({ employee_id: 12345 }).employee_id).toBe('12345');
    expect(sanitizeProfile({ org: null }).org).toBe('');
  });

  it('沒有輸入時回空物件，不丟例外', () => {
    expect(sanitizeProfile(null)).toEqual({});
    expect(sanitizeProfile(undefined)).toEqual({});
    expect(sanitizeProfile('not an object')).toEqual({});
  });
});

describe('isProfileComplete：門檻正好對齊通報驗證的硬性要求', () => {
  it('姓名與電話都有才算完成', () => {
    expect(isProfileComplete({ display_name: '林小明', phone: '0912345678' })).toBe(true);
  });
  it('缺任一項都不算', () => {
    expect(isProfileComplete({ display_name: '林小明' })).toBe(false);
    expect(isProfileComplete({ phone: '0912345678' })).toBe(false);
    expect(isProfileComplete(null)).toBe(false);
    expect(isProfileComplete({})).toBe(false);
  });
  it('只有空白不算填了', () => {
    expect(isProfileComplete({ display_name: '   ', phone: '0912345678' })).toBe(false);
    expect(isProfileComplete({ display_name: '林小明', phone: '  ' })).toBe(false);
  });
  it('員編、轄區、信箱缺了仍算完成——門檻高於驗證規則只會擋住能通報的人', () => {
    expect(isProfileComplete({ display_name: '林小明', phone: '0912345678', employee_id: '', territory: '' })).toBe(true);
  });
});

describe('rowToProfile', () => {
  it('查無此人回空白檔案而非 null，前端不必處理兩種形狀', () => {
    const p = rowToProfile(null);
    expect(p.displayName).toBe('');
    expect(p.phone).toBe('');
  });
  it('公司名稱可由環境變數預設，但使用者填過的優先', () => {
    expect(rowToProfile(null, { org: '天義企業' }).org).toBe('天義企業');
    expect(rowToProfile({ org: '子公司' }, { org: '天義企業' }).org).toBe('子公司');
  });
  it('資料庫的 NULL 轉成空字串，前端輸入框不會拿到 null', () => {
    const p = rowToProfile({ display_name: '林小明', employee_id: null, phone: null });
    expect(p.displayName).toBe('林小明');
    expect(p.employeeId).toBe('');
    expect(p.phone).toBe('');
  });
});
