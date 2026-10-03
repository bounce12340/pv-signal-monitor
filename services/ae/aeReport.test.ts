import { describe, it, expect } from 'vitest';
import {
  emptyAEReport, emptyEvent, emptyDrug, nextCaseNumber,
  checkMinimumCriteria, assessSeriousness, validateAEReport, computeCompleteness,
  computeRegulatoryClock, parseIsoDate, addDays, daysBetween,
  findDuplicates, aeToCIOMSText, aeToE2B, aeReportsToCSV, aeToSignalRecords,
  autoNarrative, patientAgeText, therapyDurationText,
  AE_ISSUE_CODES, AE_CASE_STATUSES, AE_DUPLICATE_REASONS, MAH_SERIOUS_REPORT_DAYS,
  CLOCK_BASES, createFollowUp, followUpsOf, chainRootId, countryText, isForeignCase,
  AEReport,
} from './aeReport';
import { aggregateSignals } from '../literature/signals';

const TODAY = '2026-09-08';

/** 產一份「四要素齊備」的最小有效個案，各測試再依需要覆寫欄位。 */
function validCase(over: Partial<AEReport> = {}): AEReport {
  const base = emptyAEReport(TODAY);
  return {
    ...base,
    caseNumber: 'PV-2026-0001',
    reporterName: '林業務',
    reporterPhone: '0912345678',
    reporterOrg: '某某藥品股份有限公司',
    reportSource: 'health_professional',
    awarenessDate: '2026-09-01',
    patientInitials: 'W.T.M.',
    patientSex: 'female',
    patientAgeValue: '62',
    patientAgeUnit: 'year',
    events: [{ ...emptyEvent(), id: 'ev1', verbatim: '全身紅疹合併搔癢', onsetDate: '2026-08-30', outcome: 'recovering' }],
    drugs: [{
      ...emptyDrug(true), id: 'dr1',
      brandName: 'Lipanthyl', activeIngredient: 'Fenofibrate',
      lotNumber: 'A1234', dailyDose: '200 mg QD', route: 'oral',
      indication: '高血脂', therapyStart: '2026-08-20', dechallenge: 'yes',
    }],
    ...over,
  };
}

describe('日期工具', () => {
  it('parseIsoDate 只接受 YYYY-MM-DD 並拒絕溢位日期', () => {
    expect(parseIsoDate('2026-09-08')?.toISOString().slice(0, 10)).toBe('2026-09-08');
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026/09/08')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
    expect(parseIsoDate(undefined as any)).toBeNull();
  });
  it('addDays 正確跨月與跨年', () => {
    expect(addDays('2026-09-01', 15)).toBe('2026-09-16');
    expect(addDays('2026-12-25', 15)).toBe('2027-01-09');
    expect(addDays('bad', 15)).toBe('');
  });
  it('daysBetween 回傳有號天數', () => {
    expect(daysBetween('2026-09-01', '2026-09-08')).toBe(7);
    expect(daysBetween('2026-09-08', '2026-09-01')).toBe(-7);
    expect(daysBetween('2026-09-08', 'bad')).toBeNull();
  });
});

describe('四要素效度檢核', () => {
  it('齊備時 valid=true', () => {
    expect(checkMinimumCriteria(validCase()).valid).toBe(true);
  });
  it('缺懷疑藥品時不成案', () => {
    const r = validCase({ drugs: [{ ...emptyDrug(true), brandName: '', activeIngredient: '' }] });
    const m = checkMinimumCriteria(r);
    expect(m.valid).toBe(false);
    expect(m.missing).toContain('suspectProduct');
  });
  it('只有併用藥不算懷疑藥品', () => {
    const r = validCase({ drugs: [{ ...emptyDrug(false), brandName: 'Aspirin' }] });
    expect(checkMinimumCriteria(r).suspectProduct).toBe(false);
  });
  it('性別填 unknown 不足以識別病人', () => {
    const r = validCase({ patientInitials: '', patientId: '', patientBirthDate: '', patientAgeValue: '', patientSex: 'unknown' });
    expect(checkMinimumCriteria(r).identifiablePatient).toBe(false);
  });
  it('原始通報者姓名也可構成可識別通報者', () => {
    const r = validCase({ reporterName: '', primaryReporterName: '張醫師' });
    expect(checkMinimumCriteria(r).identifiableReporter).toBe(true);
  });
});

describe('嚴重性判定', () => {
  it('未勾選任何準則為非嚴重', () => {
    expect(assessSeriousness(validCase()).serious).toBe(false);
  });
  it('任一事件勾選任一準則即為嚴重', () => {
    const r = validCase();
    r.events[0].seriousnessCriteria = ['hospitalization'];
    const a = assessSeriousness(r);
    expect(a.serious).toBe(true);
    expect(a.criteria).toEqual(['hospitalization']);
    expect(a.overridden).toBe(false);
  });
  it('後台可覆寫為嚴重並標記 overridden', () => {
    const r = validCase();
    r.triage.seriousnessOverride = 'serious';
    const a = assessSeriousness(r);
    expect(a.serious).toBe(true);
    expect(a.overridden).toBe(true);
  });
  it('後台可覆寫為非嚴重（誤勾的情況）', () => {
    const r = validCase();
    r.events[0].seriousnessCriteria = ['death'];
    r.triage.seriousnessOverride = 'non_serious';
    const a = assessSeriousness(r);
    expect(a.serious).toBe(false);
    expect(a.overridden).toBe(true);
  });
  it('多個事件的準則會去重合併', () => {
    const r = validCase();
    r.events = [
      { ...emptyEvent(), verbatim: 'A', seriousnessCriteria: ['death'] },
      { ...emptyEvent(), verbatim: 'B', seriousnessCriteria: ['death', 'life_threatening'] },
    ];
    expect(assessSeriousness(r).criteria.sort()).toEqual(['death', 'life_threatening']);
  });
});

describe('法定時限', () => {
  it('嚴重個案到期日 = 首次獲知日 + 15 天', () => {
    const r = validCase({ awarenessDate: '2026-09-01' });
    r.events[0].seriousnessCriteria = ['death'];
    const c = computeRegulatoryClock(r, TODAY);
    expect(MAH_SERIOUS_REPORT_DAYS).toBe(15);
    expect(c.dueDate).toBe('2026-09-16');
    expect(c.daysRemaining).toBe(8);
    expect(c.overdue).toBe(false);
  });
  it('非嚴重個案沒有個案別到期日（併入定期安全性報告）', () => {
    const c = computeRegulatoryClock(validCase(), TODAY);
    expect(c.dueDate).toBe('');
    expect(c.daysRemaining).toBeNull();
    expect(c.overdue).toBe(false);
  });
  it('超過期限且未送件即為逾期', () => {
    const r = validCase({ awarenessDate: '2026-08-01' });
    r.events[0].seriousnessCriteria = ['hospitalization'];
    const c = computeRegulatoryClock(r, TODAY);
    expect(c.overdue).toBe(true);
    expect(c.daysRemaining! < 0).toBe(true);
  });
  it('已送件者不再判定為逾期', () => {
    const r = validCase({ awarenessDate: '2026-08-01' });
    r.events[0].seriousnessCriteria = ['hospitalization'];
    r.triage.submittedToAuthorityAt = '2026-08-10T09:00:00.000Z';
    const c = computeRegulatoryClock(r, TODAY);
    expect(c.submitted).toBe(true);
    expect(c.overdue).toBe(false);
  });
  it('獲知日缺漏時不硬算到期日', () => {
    const r = validCase({ awarenessDate: '' });
    r.events[0].seriousnessCriteria = ['death'];
    expect(computeRegulatoryClock(r, TODAY).dueDate).toBe('');
  });
});

describe('送出前檢核', () => {
  it('有效個案無 error', () => {
    expect(validateAEReport(validCase(), TODAY).filter(i => i.level === 'error')).toEqual([]);
  });
  it('缺聯絡方式視為 error', () => {
    const codes = validateAEReport(validCase({ reporterPhone: '', reporterEmail: '' }), TODAY).map(i => i.code);
    expect(codes).toContain('reporterContactRequired');
  });
  it('反應結束日早於發生日為 error', () => {
    const r = validCase();
    r.events[0].endDate = '2026-08-01';
    const issue = validateAEReport(r, TODAY).find(i => i.code === 'endBeforeOnset');
    expect(issue?.level).toBe('error');
  });
  it('反應早於用藥開始只給 warning（仍可送出，由藥安人員判斷）', () => {
    const r = validCase();
    r.drugs[0].therapyStart = '2026-09-05';
    const issue = validateAEReport(r, TODAY).find(i => i.code === 'onsetBeforeTherapy');
    expect(issue?.level).toBe('warning');
  });
  it('未來日期一律 error', () => {
    const r = validCase({ awarenessDate: '2027-01-01' });
    const codes = validateAEReport(r, TODAY).filter(i => i.level === 'error').map(i => i.code);
    expect(codes).toContain('awarenessDateFuture');
  });
  it('勾選死亡但未填死亡日給 warning', () => {
    const r = validCase();
    r.events[0].seriousnessCriteria = ['death'];
    expect(validateAEReport(r, TODAY).map(i => i.code)).toContain('deathDateMissing');
  });
  it('缺漏欄位帶出 step，UI 才能直接跳轉', () => {
    const r = validCase({ patientInitials: '', patientId: '', patientBirthDate: '', patientAgeValue: '', patientSex: '' });
    const issue = validateAEReport(r, TODAY).find(i => i.code === 'patientRequired');
    expect(issue?.step).toBe(1);
  });
  it('所有回傳的 code 都在 AE_ISSUE_CODES 白名單內', () => {
    const messy = validCase({
      reporterName: '', reporterPhone: '', reporterEmail: '', awarenessDate: '',
      reportSource: '', patientInitials: '', patientSex: '', patientAgeValue: '',
      events: [{ ...emptyEvent(), verbatim: '' }],
      drugs: [{ ...emptyDrug(true) }],
    });
    for (const i of validateAEReport(messy, TODAY)) {
      expect(AE_ISSUE_CODES as readonly string[]).toContain(i.code);
    }
  });
});

describe('完整度', () => {
  it('空白個案接近 0，完整個案明顯較高', () => {
    expect(computeCompleteness(emptyAEReport(TODAY))).toBeLessThan(10);
    expect(computeCompleteness(validCase())).toBeGreaterThan(50);
  });
  it('回傳值恆在 0–100', () => {
    const c = computeCompleteness(validCase());
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(100);
  });
});

describe('重複個案偵測', () => {
  const a = validCase({ id: 'a', caseNumber: 'PV-2026-0001' });
  it('同病人 + 同藥 + 同反應會被抓出來', () => {
    const b = validCase({ id: 'b', caseNumber: 'PV-2026-0002' });
    const dup = findDuplicates(a, [b]);
    expect(dup).toHaveLength(1);
    expect(dup[0].score).toBeGreaterThanOrEqual(50);
    expect(dup[0].reasons).toEqual(expect.arrayContaining(['patient', 'drug', 'event']));
  });
  it('只有藥品相同不足以判定重複', () => {
    const b = validCase({ id: 'b', patientInitials: 'L.S.H.' });
    b.events = [{ ...emptyEvent(), verbatim: '肝指數上升' }];
    expect(findDuplicates(a, [b])).toEqual([]);
  });
  it('不與自己比對，也略過不成案', () => {
    const invalid = validCase({ id: 'c', status: 'invalid' });
    expect(findDuplicates(a, [a, invalid])).toEqual([]);
  });
  it('所有 reason 都在白名單內', () => {
    const b = validCase({ id: 'b' });
    for (const r of findDuplicates(a, [b])[0].reasons) {
      expect(AE_DUPLICATE_REASONS as readonly string[]).toContain(r);
    }
  });
});

describe('個案編號', () => {
  it('依年度遞增流水號', () => {
    expect(nextCaseNumber([], TODAY)).toBe('PV-2026-0001');
    expect(nextCaseNumber([{ caseNumber: 'PV-2026-0007' } as any], TODAY)).toBe('PV-2026-0008');
  });
  it('忽略他年度與格式不符的編號', () => {
    const pool = [{ caseNumber: 'PV-2025-0099' }, { caseNumber: 'X' }, { caseNumber: 'PV-2026-0003' }] as any[];
    expect(nextCaseNumber(pool, TODAY)).toBe('PV-2026-0004');
  });
});

describe('CIOMS-I 輸出', () => {
  const text = aeToCIOMSText(validCase(), TODAY);
  it('保留官方欄號，方便逐欄對照謄寫', () => {
    for (const marker of ['1. 病人姓名縮寫', '4-6.', '7+13.', '14.', '15.', '16.', '17.', '18.', '20.', '21.', '22.', '23.', '24c.', '24d.', '25a.', '26.']) {
      expect(text).toContain(marker);
    }
  });
  it('嚴重性勾選以 [X] 呈現', () => {
    const r = validCase();
    r.events[0].seriousnessCriteria = ['hospitalization'];
    const out = aeToCIOMSText(r, TODAY);
    expect(out).toContain('[X] Involved or prolonged inpatient hospitalisation');
    expect(out).toContain('嚴重 SERIOUS');
  });
  it('缺懷疑藥品時明講不成案而非留白', () => {
    const r = validCase({ drugs: [] });
    expect(aeToCIOMSText(r, TODAY)).toContain('個案不成立');
  });
});

describe('E2B(R3) 對照', () => {
  const map = aeToE2B(validCase(), TODAY);
  it('關鍵資料元素齊備', () => {
    expect(map['E.i.1.1a (Reaction as reported by primary source)']).toBe('全身紅疹合併搔癢');
    expect(map['G.k.2.3.r.1 (Substance name)']).toBe('Fenofibrate');
    expect(map['G.k.2.4 (Batch/lot number)']).toBe('A1234');
    expect(map['C.1.4 (Date report first received from source)']).toBe('2026-09-01');
  });
  it('快速通報旗標跟著嚴重性走', () => {
    expect(map['C.1.7 (Does this case fulfil the local criteria for an expedited report?)']).toBe('No');
    const r = validCase();
    r.events[0].seriousnessCriteria = ['death'];
    const m2 = aeToE2B(r, TODAY);
    expect(m2['C.1.7 (Does this case fulfil the local criteria for an expedited report?)']).toBe('Yes');
    expect(m2['E.i.3.2a (Patient died)']).toBe('Yes');
    expect(m2['E.i.3.2b (Life threatening)']).toBe('No');
  });
});

describe('CSV 匯出', () => {
  it('含 BOM 與標題列', () => {
    const csv = aeReportsToCSV([validCase()], TODAY);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.split('\n')[0]).toContain('"個案編號"');
  });
  it('中和 Excel 公式注入', () => {
    const csv = aeReportsToCSV([validCase({ patientInitials: '=cmd|calc' })], TODAY);
    expect(csv).toContain('"\'=cmd|calc"');
  });
});

describe('訊號聚合橋接', () => {
  it('自發性個案可與文獻個案共用同一套聚合', () => {
    const r = validCase({ status: 'submitted' });
    r.events[0].meddraPt = 'Rash';
    const records = aeToSignalRecords([r]);
    expect(records).toHaveLength(1);
    const report = aggregateSignals(records);
    expect(report.groups[0].ingredient).toBe('Fenofibrate');
    expect(report.groups[0].pt).toBe('Rash');
  });
  it('草稿與不成案不納入訊號', () => {
    expect(aeToSignalRecords([validCase({ status: 'draft' })])).toEqual([]);
    expect(aeToSignalRecords([validCase({ status: 'invalid' })])).toEqual([]);
  });
  it('嚴重個案在聚合中被計為 serious', () => {
    const r = validCase({ status: 'submitted' });
    r.events[0].seriousnessCriteria = ['death'];
    expect(aggregateSignals(aeToSignalRecords([r])).groups[0].seriousCount).toBe(1);
  });
});

describe('敘述與衍生欄位', () => {
  it('autoNarrative 會帶出藥品、反應與嚴重性結論', () => {
    const n = autoNarrative(validCase(), TODAY);
    expect(n).toContain('Lipanthyl');
    expect(n).toContain('全身紅疹合併搔癢');
    expect(n).toContain('非嚴重');
  });
  it('patientAgeText 優先採用填寫的年齡', () => {
    expect(patientAgeText(validCase(), TODAY)).toBe('62歲');
  });
  it('patientAgeText 無年齡時由出生日期推算（生日當天不可少算一歲）', () => {
    expect(patientAgeText(validCase({ patientAgeValue: '', patientBirthDate: '1964-09-08' }), TODAY)).toBe('62歲');
    expect(patientAgeText(validCase({ patientAgeValue: '', patientBirthDate: '1964-09-09' }), TODAY)).toBe('61歲');
    expect(patientAgeText(validCase({ patientAgeValue: '', patientBirthDate: '2027-01-01' }), TODAY)).toBe('');
  });
  it('therapyDurationText 由起訖日推算（含首尾兩日）', () => {
    expect(therapyDurationText({ ...emptyDrug(), therapyStart: '2026-08-20', therapyEnd: '2026-08-24' })).toBe('5 天');
    expect(therapyDurationText({ ...emptyDrug(), therapyDuration: '約兩週' })).toBe('約兩週');
  });
});

describe('CIOMS 編碼可信度標示', () => {
  it('未經詞典驗證的 MedDRA PT 在送件文件上必須標示出來', () => {
    const r = validCase();
    r.events[0].meddraPt = '全身紅疹合併搔癢';
    r.events[0].meddraVerified = false;
    expect(aeToCIOMSText(r, TODAY)).toContain('未經詞典驗證');
  });
  it('已驗證的 PT 不加註記', () => {
    const r = validCase();
    r.events[0].meddraPt = 'Rash';
    r.events[0].meddraVerified = true;
    expect(aeToCIOMSText(r, TODAY)).not.toContain('未經詞典驗證');
  });
});

describe('境外個案國別', () => {
  it('預設為台灣，不算境外', () => {
    const r = validCase();
    expect(r.country).toBe('TW');
    expect(countryText(r)).toBe('台灣');
    expect(isForeignCase(r)).toBe(false);
  });
  it('非台灣即為境外個案', () => {
    expect(isForeignCase(validCase({ country: 'JP' }))).toBe(true);
    expect(countryText(validCase({ country: 'JP' }), 'en')).toBe('Japan');
  });
  it('other 取自填國名', () => {
    const r = validCase({ country: 'other', countryOther: '韓國' });
    expect(countryText(r)).toBe('韓國');
    expect(isForeignCase(r)).toBe(true);
  });
  it('選 other 卻沒填國名是 error，且不算境外（資訊不足）', () => {
    const r = validCase({ country: 'other', countryOther: '' });
    const issue = validateAEReport(r, TODAY).find(i => i.code === 'countryOtherRequired');
    expect(issue?.level).toBe('error');
    expect(isForeignCase(r)).toBe(false);
  });
  it('國別空白是 error', () => {
    const codes = validateAEReport(validCase({ country: '' }), TODAY)
      .filter(i => i.level === 'error').map(i => i.code);
    expect(codes).toContain('countryRequired');
  });
  it('CIOMS 1a 印出國別並標示境外', () => {
    const out = aeToCIOMSText(validCase({ country: 'JP' }), TODAY);
    expect(out).toContain('日本');
    expect(out).toContain('境外個案');
  });
});

describe('追蹤報告', () => {
  const parent = validCase({ id: 'p1', caseNumber: 'PV-2026-0001', awarenessDate: '2026-08-01' });

  it('由原案建立，Day 0 設為獲知新資訊日而非原案獲知日', () => {
    const fu = createFollowUp(parent, [parent], TODAY);
    expect(fu.reportType).toBe('follow_up');
    expect(fu.awarenessDate).toBe(TODAY);
    expect(fu.awarenessDate).not.toBe(parent.awarenessDate);
    expect(fu.followUpOfId).toBe('p1');
    expect(fu.followUpOf).toBe('PV-2026-0001');
    expect(fu.caseNumber).toBe('PV-2026-0001-F1');
  });
  it('追蹤報告編號依既有數量遞增', () => {
    const f1 = createFollowUp(parent, [parent], TODAY);
    const f2 = createFollowUp(parent, [parent, f1], TODAY);
    expect(f2.caseNumber).toBe('PV-2026-0001-F2');
  });
  it('不繼承原案的送件紀錄與附件，且子結構為深拷貝', () => {
    const p2: AEReport = {
      ...parent,
      attachments: [{ id: 'a1', name: 'x.jpg', mime: 'image/jpeg', size: 1, dataUrl: 'data:', addedAt: '' }],
      triage: { ...parent.triage, submittedToAuthorityAt: '2026-08-05T00:00:00Z', authorityReceiptNo: 'R-1', validityConfirmed: true },
    };
    const fu = createFollowUp(p2, [p2], TODAY);
    expect(fu.attachments).toEqual([]);
    expect(fu.triage.submittedToAuthorityAt).toBe('');
    expect(fu.triage.authorityReceiptNo).toBe('');
    expect(fu.triage.validityConfirmed).toBe(false);
    // 深拷貝：改追蹤報告不得污染原案
    fu.events[0].verbatim = '改過的描述';
    fu.drugs[0].lotNumber = 'B999';
    expect(p2.events[0].verbatim).toBe('全身紅疹合併搔癢');
    expect(p2.drugs[0].lotNumber).toBe('A1234');
    expect(fu.events[0].id).not.toBe(p2.events[0].id);
  });
  it('建立時就留下稽核紀錄', () => {
    const fu = createFollowUp(parent, [parent], TODAY, '王藥師');
    expect(fu.auditTrail).toHaveLength(1);
    expect(fu.auditTrail[0].action).toBe('follow_up_created');
    expect(fu.auditTrail[0].actor).toBe('王藥師');
  });
  it('followUpsOf 找出直接子代並依獲知日排序', () => {
    const f1 = { ...createFollowUp(parent, [parent], '2026-09-02'), id: 'f1', awarenessDate: '2026-09-02' };
    const f2 = { ...createFollowUp(parent, [parent], '2026-09-01'), id: 'f2', awarenessDate: '2026-09-01' };
    const list = followUpsOf(parent, [parent, f1, f2]);
    expect(list.map(x => x.id)).toEqual(['f2', 'f1']);
  });
  it('chainRootId 沿鏈上溯到初始報告', () => {
    const f1 = { ...createFollowUp(parent, [parent], TODAY), id: 'f1' };
    const f2 = { ...createFollowUp(f1, [parent, f1], TODAY), id: 'f2', followUpOfId: 'f1' };
    expect(chainRootId(f2, [parent, f1, f2])).toBe('p1');
  });
  it('chainRootId 遇到環狀資料不會無限迴圈', () => {
    const a: AEReport = { ...validCase({ id: 'a' }), followUpOfId: 'b' };
    const b: AEReport = { ...validCase({ id: 'b' }), followUpOfId: 'a' };
    expect(() => chainRootId(a, [a, b])).not.toThrow();
  });
});

describe('追蹤報告的法定時鐘', () => {
  const serious = (over: Partial<AEReport> = {}): AEReport => {
    const r = validCase({ awarenessDate: '2026-09-01', ...over });
    r.events[0].seriousnessCriteria = ['hospitalization'];
    return r;
  };

  it('帶來重要新資訊的追蹤報告，15 日時鐘自本次獲知日重新起算', () => {
    const r = serious({ reportType: 'follow_up', hasSignificantNewInfo: true, awarenessDate: '2026-09-05' });
    const c = computeRegulatoryClock(r, TODAY);
    expect(c.basis).toBe('expedited');
    expect(c.dueDate).toBe('2026-09-20');
  });
  it('未帶來重要新資訊的追蹤報告不重啟時鐘', () => {
    const r = serious({ reportType: 'follow_up', hasSignificantNewInfo: false });
    const c = computeRegulatoryClock(r, TODAY);
    expect(c.basis).toBe('followup_no_new_info');
    expect(c.dueDate).toBe('');
    expect(c.overdue).toBe(false);
  });
  it('初始報告不受 hasSignificantNewInfo 影響', () => {
    const c = computeRegulatoryClock(serious({ reportType: 'initial', hasSignificantNewInfo: false }), TODAY);
    expect(c.basis).toBe('expedited');
    expect(c.dueDate).toBe('2026-09-16');
  });
  it('非嚴重與缺 Day 0 各自有可辨識的依據', () => {
    expect(computeRegulatoryClock(validCase(), TODAY).basis).toBe('non_serious');
    expect(computeRegulatoryClock(serious({ awarenessDate: '' }), TODAY).basis).toBe('no_day0');
  });
  it('回傳的 basis 都在白名單內', () => {
    for (const r of [validCase(), serious(), serious({ reportType: 'follow_up', hasSignificantNewInfo: false }), serious({ awarenessDate: '' })]) {
      expect(CLOCK_BASES as readonly string[]).toContain(computeRegulatoryClock(r, TODAY).basis);
    }
  });
});

describe('重複偵測排除追蹤鏈', () => {
  it('追蹤報告不會被標成原案的重複個案', () => {
    const parent = validCase({ id: 'p1', caseNumber: 'PV-2026-0001' });
    const fu = createFollowUp(parent, [parent], TODAY);
    // 內容幾乎完全相同，若不排除追蹤鏈必定超過門檻
    expect(findDuplicates(fu, [parent, fu])).toEqual([]);
    expect(findDuplicates(parent, [parent, fu])).toEqual([]);
  });
  it('同一鏈的孫代也排除', () => {
    const parent = validCase({ id: 'p1', caseNumber: 'PV-2026-0001' });
    const f1 = { ...createFollowUp(parent, [parent], TODAY), id: 'f1' };
    const f2 = { ...createFollowUp(f1, [parent, f1], TODAY), id: 'f2', followUpOfId: 'f1' };
    expect(findDuplicates(f2, [parent, f1, f2])).toEqual([]);
  });
  it('不同鏈的真重複仍然抓得到', () => {
    const a = validCase({ id: 'a', caseNumber: 'PV-2026-0001' });
    const b = validCase({ id: 'b', caseNumber: 'PV-2026-0002' });
    expect(findDuplicates(a, [b])).toHaveLength(1);
  });
});

describe('CSV 的追蹤報告欄位', () => {
  it('輸出原案編號、重要新資訊與期限依據', () => {
    const parent = validCase({ id: 'p1', caseNumber: 'PV-2026-0001' });
    const fu = createFollowUp(parent, [parent], TODAY);
    const csv = aeReportsToCSV([fu], TODAY);
    expect(csv.split('\n')[0]).toContain('"原案編號"');
    expect(csv.split('\n')[0]).toContain('"重要新資訊"');
    expect(csv.split('\n')[0]).toContain('"境外個案"');
    expect(csv).toContain('"PV-2026-0001"');
  });
});

// ─────────────────────────────────────────────────────────────
// 轉知個案：來源端獲知日與轉報原廠
//
// 這一組的動機是一個具體的實務錯誤：主管機關轉知的個案，表單上最顯眼的日期是
// 來源端的日期，而法定 15 日時鐘要從公司獲知日起算。混為一談，時鐘就從錯的
// 那天開始跑，而且事後很難察覺——收件匣看起來完全正常。
// ─────────────────────────────────────────────────────────────

describe('來源端獲知日不影響法定時鐘', () => {
  const serious = (over: Partial<AEReport> = {}) => validCase({
    events: [{ ...emptyEvent(), id: 'ev1', verbatim: '呼吸困難', seriousnessCriteria: ['hospitalization'] }],
    ...over,
  });

  it('只有 awarenessDate 決定 Day 0 與到期日', () => {
    const c = serious({ awarenessDate: '2026-09-24', sourceAwarenessDate: '2026-09-21' });
    const clock = computeRegulatoryClock(c, TODAY);
    expect(clock.day0).toBe('2026-09-24');
    expect(clock.dueDate).toBe('2026-10-09');   // 24 + 15
  });

  it('改來源端獲知日不會動到到期日', () => {
    const base = serious({ awarenessDate: '2026-09-24', sourceAwarenessDate: '2026-09-21' });
    const moved = { ...base, sourceAwarenessDate: '2026-08-01' };
    expect(computeRegulatoryClock(moved, TODAY).dueDate)
      .toBe(computeRegulatoryClock(base, TODAY).dueDate);
  });

  it('沒填來源端獲知日也照常運作', () => {
    const c = serious({ awarenessDate: '2026-09-24', sourceAwarenessDate: '' });
    expect(computeRegulatoryClock(c, TODAY).dueDate).toBe('2026-10-09');
  });
});

describe('來源端獲知日的時序檢核', () => {
  it('晚於公司獲知日 → 警告（可能兩個日期填反了）', () => {
    const c = validCase({ awarenessDate: '2026-09-01', sourceAwarenessDate: '2026-09-05' });
    const issue = validateAEReport(c, TODAY).find(i => i.code === 'sourceAwarenessAfterAwareness');
    expect(issue?.level).toBe('warning');
  });

  it('早於或等於公司獲知日 → 不出警告（正常情形）', () => {
    for (const d of ['2026-08-20', '2026-09-01']) {
      const c = validCase({ awarenessDate: '2026-09-01', sourceAwarenessDate: d });
      expect(validateAEReport(c, TODAY).some(i => i.code === 'sourceAwarenessAfterAwareness')).toBe(false);
    }
  });

  it('未來日期 → 錯誤', () => {
    const c = validCase({ sourceAwarenessDate: '2099-01-01' });
    const issue = validateAEReport(c, TODAY).find(i => i.code === 'sourceAwarenessFuture');
    expect(issue?.level).toBe('error');
  });

  it('留空時不產生任何相關檢核——這是選填欄位', () => {
    const codes = validateAEReport(validCase({ sourceAwarenessDate: '' }), TODAY).map(i => i.code);
    expect(codes).not.toContain('sourceAwarenessFuture');
    expect(codes).not.toContain('sourceAwarenessAfterAwareness');
  });

  it('⚠️ 警告不擋送出：轉知文件的日期常有落差，擋著不讓通報比日期怪異嚴重', () => {
    const c = validCase({ awarenessDate: '2026-09-01', sourceAwarenessDate: '2026-09-05' });
    expect(validateAEReport(c, TODAY).filter(i => i.level === 'error')).toHaveLength(0);
  });
});

describe('CIOMS 輸出帶上轉知個案的兩個新欄位', () => {
  it('有填才印，且標明來源端日期不是時鐘起算日', () => {
    const c = validCase({ awarenessDate: '2026-09-24', sourceAwarenessDate: '2026-09-21' });
    const txt = aeToCIOMSText(c, TODAY);
    expect(txt).toContain('2026-09-21');
    expect(txt).toContain('非時鐘起算日');
  });

  it('轉報原廠的日期與原廠案號會印出來', () => {
    const c = validCase({
      triage: { ...emptyAEReport(TODAY).triage, transmittedToMahAt: '2026-09-26', mahCaseNumber: 'ADV-2026-00123' },
    });
    const txt = aeToCIOMSText(c, TODAY);
    expect(txt).toContain('ADV-2026-00123');
    expect(txt).toContain('2026-09-26');
  });

  it('沒填就完全不出現那幾行，不留空欄位污染表格', () => {
    const txt = aeToCIOMSText(validCase(), TODAY);
    expect(txt).not.toContain('來源端獲知');
    expect(txt).not.toContain('原廠個案編號');
    expect(txt).not.toContain('轉報原廠日');
  });
});

describe('CSV 匯出含新欄位', () => {
  it('標頭與資料都對得上', () => {
    const c = validCase({
      awarenessDate: '2026-09-24',
      sourceAwarenessDate: '2026-09-21',
      triage: { ...emptyAEReport(TODAY).triage, transmittedToMahAt: '2026-09-26', mahCaseNumber: 'ADV-2026-00123' },
    });
    const csv = aeReportsToCSV([c], TODAY);
    const [header, row] = csv.split('\n');
    for (const col of ['來源端獲知日', '轉報原廠日', '原廠個案編號']) {
      expect(header).toContain(col);
    }
    expect(row).toContain('2026-09-21');
    expect(row).toContain('2026-09-26');
    expect(row).toContain('ADV-2026-00123');
  });
});
