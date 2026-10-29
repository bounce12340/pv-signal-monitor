# 主管機關安全性公告（MVP）

「安全公告」頁（`components/RegulatoryAlertsMode.tsx`）列出各國主管機關的藥品安全性公告。系統依「監測成分」比對公告，由 PV 人員逐筆核閱。

## 為什麼要做

《藥品安全監視管理辦法》（111-04-15 修正，112-01-01 施行）有兩條相關規定：

- **第 6 條第 1 項第 3 款**：藥品在德、美、英、法、日、瑞士、加、澳、比、瑞典（十大醫藥先進國家）「因不良反應被暫停使用或下市」時，藥商應**自知悉之日起三日內**通報。
- **第 5 條第 2 款**：安全性監視計畫須載明「藥品安全性資訊來源及蒐集方式」。

三日的期限只能靠每天監看才守得住。季度文獻檢索的頻率不夠。

> ⚠️ 尚待 QA/RA 確認：系統取得公告（`first_seen`）是否即構成「知悉」。如果是，SOP 必須規定每天由誰核閱這一頁。本頁只是輔助工具，不能取代 SOP 的人工監視。

## 來源（2026-10 驗證）

| 來源 | 國家 | 取得方式 | 限制 |
|---|---|---|---|
| MHRA Drug Safety Update | 英 | GOV.UK Search API（JSON） | 每次取最新 50 筆 |
| FDA Drug Safety Communications | 美 | 官網列表頁（HTML） | 不含 MedWatch 回收與仿單一般更新 |
| EMA DHPC | 歐盟 | 官方 DHPC 資料檔（JSON） | 只涵蓋集中審查藥品；不含 PRAC 訊號建議 |
| PMDA 安全対策 | 日 | RSS ＋「使用上の注意の改訂指示」頁面 | 改訂指示拆成每個成分一筆；成分名是片假名 |
| BfArM Risikoinformationen | 德 | RSS | 德文 |
| ANSM Informations de sécurité | 法 | RSS | **只列當天的公告**；尚未在有資料的日子看過實際項目格式 |
| TFDA 藥品安全資訊 | 台 | 官網列表第 1 頁（HTML） | 只有最新 10 筆；開放資料集停在 2022 年，不能用 |

**未自動監測**（畫面上會列出，須人工查看）：

| 國家 | 原因 |
|---|---|
| 瑞士 Swissmedic | 只有第三方代轉的 RSS |
| 加拿大 Health Canada | RSS 只有最新 3 筆且多為醫材；完整資料檔約 16 MB |
| 澳洲 TGA | 驗證時連不上 |
| 比利時 FAMHP | 沒有安全性公告的資料來源 |
| 瑞典 MPA | 沒有安全性公告的資料來源 |

多數老藥在歐盟是各國審查，EMA 的 DHPC 不會涵蓋它們。德、法要靠 BfArM 與 ANSM，比利時與瑞典目前只能人工查看。

## 運作方式

- **抓取**：`wrangler.jsonc` 設定每小時第 23 分執行一次 cron，每次輪到一個來源（`worker/regfeeds/sources.ts`）。7 個來源每 7 小時輪完一圈，所以每個來源一天約抓 3 次。
  - 只會抓 `SOURCES` 固定列出的網址，請求內容不能指定網址。
  - 每次請求有逾時（20 秒）與大小上限（5 MB）。
- **儲存**：資料存在 `DB`（pv-signal-monitor）的 `reg_alerts`，以「來源:網址」去重。
  - `first_seen` 是第一次取得的時間，之後不再改動。
  - 內容沒變的公告不會重寫。
- **來源狀態**：每個來源最近一次的成功、失敗、筆數記在 `reg_sources`。如果官網改版導致解析失敗，會記為「失敗」，不會被當成 0 筆公告。
- **核閱與成分清單**：都寫進 `reg_audit`。
  - 核閱分「不相關／已評估／需後續行動」，「需後續行動」必須填說明。
  - 操作者一律取自已驗證的 Access JWT，表單內容無法指定。
  - 這張表只能新增，資料庫 trigger 擋下修改與刪除。
- **權限**：`/api/reg-alerts*` 只限 PV（`pvGate`），業務會收到 403。
- **比對**：在前端進行（`services/regulatory/match.ts`）。
  - 英文等拉丁字母的詞只要求詞首對齊，所以 `theophyllin` 能比到 `theophylline`；大小寫與重音不影響比對。
  - 中文、日文用子字串比對。
  - 「含暫停／下市字樣」只是提示，系統不判斷原因（例如品質回收）。
- **安全性**：公告的標題、摘要、網址都是第三方內容。
  - 文字一律以純文字呈現。
  - 只有 http(s) 網址會變成連結，Worker 與前端各檢查一次。

## 監測成分怎麼填

各國公告用當地語言撰寫，所以每個成分要附上各國的寫法，例如：

```
theophylline | theophyllin, théophylline, aminophylline, テオフィリン, 茶鹼
pravastatin | pravastatine, プラバスタチン, 普伐他汀
```

- 鹽類或相關化合物（如 aminophylline）要列為同義詞。
- 日文一般名要用片假名，否則比不到 PMDA 的改訂指示。

## 上線步驟

合併到 main 會自動部署，cron 也會跟著開始執行。**請先完成第 1、2 步再合併。**

1. 備份正式 D1：
   ```bash
   npx wrangler d1 export pv-signal-monitor --remote --output=backup-before-regfeeds.sql
   ```
2. 建立資料表（只新增四個物件，不動既有的 `snapshots`；可重跑）：
   ```bash
   npx wrangler d1 execute pv-signal-monitor --remote --file=worker/regfeeds/schema.sql
   ```
3. 合併 PR，等 CI 部署完成。
4. 開「安全公告」頁：
   - 用每個來源的「立即更新」先抓一輪。同一來源 5 分鐘內只能手動更新一次。
   - 確認來源狀態都是「正常」。
5. 在「編輯監測成分」填入監測成分與同義詞。

如果漏了第 2 步，頁面會顯示「reg_alerts tables missing」，cron 只會記 log，不影響其他功能。

**回滾**：

- 用 `npx wrangler rollback` 回到前一版即可停止抓取。
- 資料表可以留著，不影響其他功能。
- 如果要刪表，請先匯出：`reg_audit` 是稽核軌跡。

## 已知限制與後續

- HTML 解析（FDA、TFDA、PMDA 改訂頁）會因官網改版失效。失效時來源狀態會顯示失敗，需要修改 `worker/regfeeds/parsers.ts`。
- TFDA 與 FDA 只抓列表第一頁。如果兩次抓取之間的新公告超過一頁（10 筆或 40 餘筆）會漏抓，目前的發布頻率遠低於此。
- 以下項目尚未做：
  - EMA PRAC 訊號建議（資料檔約 35 MB）
  - openFDA 仿單版本比對
  - 與 AE 主檔連動（提示可能需要修改仿單）
  - 未涵蓋的國家
