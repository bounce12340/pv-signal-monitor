# AE 通報切換上線清單（PR 5：pvlink.uic-ai.com → pv.uic-ai.com）

把業務的不良反應通報與藥安的後台收案，從 PV-Link（`pvlink.uic-ai.com`）切換到 `pv.uic-ai.com`。
**這份清單由 Josh 操作**，程式不會自動做其中任何一步。背景與各 PR 內容見 [`ae-integration-plan.md`](ae-integration-plan.md)。

## 先讀這段

- **通報管道不能中斷。** `pv.uic-ai.com` 的通報畫面驗收通過（階段 2、4）之前，不要動 `pvlink.uic-ai.com`。
- **兩邊共用同一份資料。** 這支 Worker 綁的是 PV-Link 正在用的 D1 `pv-link-ae` 與 R2 `pv-link-ae-attachments`，
  所以不用搬資料。後果是：在階段 7 之前，兩個網址都看得到、也都寫得進同一批個案。
- **pvlink 還在產生重號。** 它跑的是 PV-Link 的舊 Worker（前端配號），業務送出的個案會是 `PV-<年>-0001`；
  repo 已刪除、無法修。所以階段 5 到階段 7 之間越短越好。
- **不直接寫正式 D1。** 本清單裡的 `wrangler d1 execute` 全部是 `SELECT`。測試個案一律由真人登入後從表單送出——
  直接插入資料等於偽造稽核軌跡上的操作者。
- **真實資料不進 repo。** 查詢結果、員工信箱、備份檔都留在本機，不要貼進 issue、PR 或這份文件。
- 以下指令都在本 repo 根目錄執行（`wrangler.jsonc` 所在處），預設操作 `pv-signal-monitor` 這支 Worker。

## 總覽

| 階段 | 做什麼 | 影響業務？ | 能回復嗎 |
|---|---|---|---|
| 0 | 備份、唯讀檢查、設 `AE_PV_EMAILS` secret | 否 | — |
| 1 | 部署 `main` 到 pv.uic-ai.com，藥安冒煙測試 | 否（業務還沒在 Access 裡） | `wrangler rollback` |
| 2 | 虛擬個案驗收（藥安帳號） | 否 | 軟刪除測試個案 |
| 3 | `/api/sync` 限制為 PV（已由 [#9](https://github.com/bounce12340/pv-signal-monitor/pull/9) 完成，隨階段 1 部署） | 否 | — |
| 4 | 加一個測試業務帳號，驗角色分權 | 否 | 從 Access 移除 |
| 5 | 全體業務加入 Access，公布新網址 | **是**：開始在新網址通報 | 從 Access 移除 |
| 6 | 清空各手機上 PV-Link 的待補送佇列 | 是 | — |
| 7 | `pvlink.uic-ai.com` 轉址 | 是 | 停用轉址規則 |
| 8 | 撤除 PV-Link 的 Pages 專案與 Worker | 否 | **不可逆** |
| 9 | 收尾：重號處理、文件更新 | 否 | — |

每一階段的「通過條件」全部打勾才進下一階段。

---

## 階段 0　事前準備（不影響線上）

### 0-1　記下目前線上版本（回復用）

```bash
npx wrangler deployments status
```

記下目前的 version ID。階段 1 出問題時回復到這一版。

### 0-2　備份

```bash
# AE 資料（含病人資料）：存到 repo 以外的資料夾，不要 commit
npx wrangler d1 export pv-link-ae --remote --output=<repo 以外的路徑>/pv-link-ae-$(date +%Y%m%d).sql
# 同步快照
npx wrangler d1 export pv-signal-monitor --remote --output=<repo 以外的路徑>/pv-signal-monitor-$(date +%Y%m%d).sql
# 另記下 Time Travel 的目前 bookmark（D1 內建的時間點回復，付費方案保留 30 天、免費方案 7 天）
npx wrangler d1 time-travel info pv-link-ae
```

⚠️ 匯出進行中，該資料庫的其他請求會被擋住（Cloudflare 文件明載）。`pv-link-ae` 是 pvlink 正在用的資料庫，
請挑業務不會通報的時段執行。

### 0-3　唯讀檢查 schema

```bash
npx wrangler d1 execute pv-link-ae --remote --command \
  "SELECT type, name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY type, name"
npx wrangler d1 execute pv-link-ae --remote --command \
  "SELECT id, applied_at FROM schema_migrations ORDER BY id"
```

應看到：`ae_cases`、`ae_audit`、`ae_attachments`、`ae_users`、`ae_case_work`、`ae_work_audit`、`ae_notifications`
與 `schema_migrations` 等表；`schema_migrations` 有 `001`–`004` 四筆。本 repo 的 `worker/ae/migrations/` 與 PV-Link
完全相同、沒有新增 migration，所以**這次切換不需要跑任何 migration**。若缺表或缺帳本紀錄，先停下來，不要部署。

### 0-4　確認誰是藥安（唯讀）

角色來源依序是 `AE_PV_EMAILS` secret、再來是 `ae_users.role`。`ae_users` 是 PV-Link 時期就在用的表，
那裡登記為 `pv` 的人，部署後在 pv.uic-ai.com 也是藥安——**也就能用公司的 LLM 額度**。

```bash
npx wrangler d1 execute pv-link-ae --remote --command \
  "SELECT email, role FROM ae_users ORDER BY role, email"
```

確認 `role = 'pv'` 的只有該是藥安的人。結果是真實信箱，看完即可，不要貼到任何地方。

### 0-5　設定 secret

```bash
npx wrangler secret list              # 應已有 OLLAMA_API_KEY（只列名稱，不顯示值）
npx wrangler secret put AE_PV_EMAILS  # 互動輸入：藥安同仁的個人公司信箱，逗號分隔
npx wrangler secret list              # 確認多了 AE_PV_EMAILS
```

- 只能用 `wrangler secret put`，不可寫進 `wrangler.jsonc` 的 `vars`（是真實員工信箱，repo 是公開的）。
- `secret put` 會立即以「目前線上的程式碼 + 新 secret」部署一個新版本，對現有功能沒有影響。
- **必須在階段 1 之前做。** `main` 的 `/llm/*`、`/ollama-cloud/*` 與 `/api/sync*` 只放行 PV，沒有這個 secret（且 `ae_users` 也沒有 pv）時，
  部署當下所有人的 AI 功能與雲端同步都會變成 403。

### 0-6　確認 Access 設定

在 Cloudflare 後台 Zero Trust → Access → Applications 找到 pv.uic-ai.com 的 application：

- [ ] AUD tag 與 `wrangler.jsonc` 的 `ACCESS_AUD` 一致（不一致時 AE API 與 AI 功能一律 401）。
- [ ] Policy 是 Allow，Include 為**逐一列出的個人公司信箱**，沒有 `Emails ending in`、`Everyone`、只要求 One-time PIN 這類規則。
- [ ] 目前名單裡只有藥安同仁。**這一階段不要加業務。**

### 0-7　確認 CI 不會搶先部署

`.github/workflows/ci.yml` 在 `main` 有新 commit 時，只要 repo 設了 `CLOUDFLARE_API_TOKEN` secret 就會自動 `wrangler deploy`。
目前沒有設（合併 #2–#6 時部署步驟都被跳過）。切換期間請維持不設，讓部署時點完全由您決定。

### 0-8　重號基準（唯讀）

```bash
npx wrangler d1 execute pv-link-ae --remote --command \
  "SELECT case_number, COUNT(*) AS n FROM ae_cases WHERE deleted_at IS NULL GROUP BY case_number HAVING n > 1 ORDER BY case_number"
```

記下重號的組數就好，用來在階段 9 比對切換期間是否又增加。

**階段 0 通過條件**

- [ ] 兩份備份檔存在、大小合理，且不在 repo 資料夾內
- [ ] schema 與 `schema_migrations` 帳本符合預期
- [ ] `ae_users` 的 pv 名單正確
- [ ] `AE_PV_EMAILS`、`OLLAMA_API_KEY` 都在 `secret list` 裡
- [ ] Access AUD 一致，名單只有藥安、逐一列舉

---

## 階段 1　部署 `main`

```bash
git checkout main && git pull origin main
npm ci
npx tsc --noEmit && npm test && npm run build
npx wrangler deploy
npx wrangler deployments status   # 記下新的 version ID
```

部署的內容是 `main`（`8fdeed1` 或之後）。Worker 部署不會動 D1 的資料或 schema。

### 冒煙測試（用藥安帳號、在電腦上）

| 檢查 | 怎麼做 | 預期 |
|---|---|---|
| 角色 | 瀏覽器開 `https://pv.uic-ai.com/api/me` | JSON 裡 `"role":"pv"`，`email` 是自己 |
| 主系統 | 開 `https://pv.uic-ai.com/` | 照常進主系統，不會被要求先填通報者資料 |
| AI 功能 | 跑一次會呼叫模型的功能（例如標籤 AE 主檔擷取） | 正常回應，沒有 403 |
| 通報收案 | 左側選單「通報收案」 | 列出既有個案，數量與 pvlink 後台一致（同一個資料庫） |
| 通報表單 | 開 `https://pv.uic-ai.com/#/report` | 出現業務通報表單（首次會先出現「通報者基本資料」） |
| 雲端同步 | 開 `https://pv.uic-ai.com/api/sync/latest`，再打開主系統的同步面板 | 回 JSON（不是 403）；原本有用同步的話，`updated_at`／`device` 與同步面板顯示的雲端快照都是部署前那一份 |

### 出問題時

| 症狀 | 原因 | 處理 |
|---|---|---|
| AI 功能 403 `requires PV role` | `AE_PV_EMAILS` 沒設、打錯，或不是這支 Worker 的 | 重做 0-5；不必重新部署 |
| AE API 401 `unauthorized`（或 `unauthorized: missing Access token`） | 沒經過 Access，或 JWT 驗不過（多半是 `ACCESS_AUD` 不一致） | 重做 0-6 |
| AE API 503 `Access configuration incomplete` | `ACCESS_TEAM_DOMAIN`／`ACCESS_AUD` 只設了一個 | 檢查 `wrangler.jsonc` 的 `vars` |
| 同步回 403 `requires PV role` | 同 AI 功能 403 | 重做 0-5 |
| 同步不是 403，但 `updated_at` 是 `null`、看不到部署前的雲端快照 | 快照以信箱為鍵，現在改取 Access JWT 裡的 email（原本取標頭）；兩者理論上相同，若大小寫或內容不同就會對不上 | **先不要在同步面板按上傳**。唯讀比對：`npx wrangler d1 execute pv-signal-monitor --remote --command "SELECT DISTINCT user_email FROM snapshots"` 與 `/api/me` 的 `email`；對不上就回復上一版並告訴我，不要改 D1 |
| 其他無法當場排除的錯誤 | — | 回復：`npx wrangler rollback <0-1 記下的 version ID> --message "rollback AE cutover"` |

回復只換程式碼版本，不影響 D1 資料與 secret。

**階段 1 通過條件**：上表六項全部符合預期。

---

## 階段 2　虛擬個案驗收（藥安帳號）

取代 PV-Link 的 `docs/uat-demo-case.md`（那份寫的是 pvlink 網址與舊選單）。用一筆**明確標示為測試**的虛擬個案，
走一遍「手機送出 → 後台收案」。

### 為什麼從表單送，不直接寫資料庫

稽核軌跡上的操作者只取自 Worker 驗證過的 Access JWT，前端與資料庫都無法自填。直接在 D1 插入一筆個案，
等於造出一筆沒有真實操作者的稽核紀錄——正好是這套設計要防止的事。

### 步驟

1. 手機開 **`https://pv.uic-ai.com/#/report`**，以自己的公司信箱登入 Access。
   首次會出現「通報者基本資料」，填自己的資料（只出現一次；PV-Link 上填過的話已經有了，兩邊共用 `ae_users`）。
2. 依下表填寫，在最後一步附上一張**虛構的**照片（例如寫著「TEST」的白紙），送出。記下完成畫面上的**個案編號**。
3. 電腦開 **`https://pv.uic-ai.com/`** → 左側選單「**通報收案**」→ 找到該編號。
4. 依「後台檢查清單」逐項確認。
5. 驗離線補送（見下方）。
6. 收尾（見最後一節）。

### 測試資料

| 步驟 | 欄位 | 填入 |
|---|---|---|
| ① 通報者 | 首次獲知日 | 今天 |
| | 資訊來源 | 醫療專業人員 |
| | 原始通報者姓名／服務院所 | 【測試】王藥師／測試醫院 |
| ② 病人 | 姓名縮寫／性別／年齡 | TEST／女／67 歲 |
| ③ 不良反應 | 不良反應描述 | **【測試資料，請勿通報】**服藥後第三天出現皮疹合併發燒，住院治療 |
| | 反應發生日／目前結果 | 3 天前／復原中 |
| | 嚴重性準則 | 勾「住院或延長住院期間」 |
| ④ 懷疑藥品 | 商品名／主成分 | **測試藥品 TEST-001**／Testoline |
| | 批號／給藥途徑 | L-TEST／口服 |
| ⑤ 併用藥與病史 | — | 可略過 |
| ⑥ 確認送出 | 附件 | 一張虛構照片 |

刻意的選擇：

- **藥品不用真實的公司產品**：免得測試個案日後被帶進任何以成分或產品統計的報表。
- **勾一個嚴重性準則**：後台才會出現 15 日法規時鐘，才驗得到最關鍵的那一段。
- **描述開頭標【測試資料，請勿通報】**：萬一被誤帶進送件流程，看的人第一眼就知道。

### 後台檢查清單

| 位置 | 應該看到 |
|---|---|
| 完成畫面／收件匣 | 個案編號由系統配發：`PV-<今年>-<流水號>`，流水號是今年最大號 + 1，**不是** `0001`（除非這是今年第一筆） |
| 收件匣卡片 | 「嚴重」與待收案狀態；法規剩餘天數約 15 天 |
| 法定到期日 | 首次獲知日 + 15 天 |
| 效度判定 | 四要素（可辨識病人、通報者、可疑藥品、不良事件）皆齊備 |
| 嚴重性判定 | 「住院或延長住院期間」被標示 |
| 個案內容 | 與手機上填的一致；通報者是自己 |
| 附件 | 點得開那張虛構照片（= R2 綁定正常） |
| 稽核軌跡 | 「業務送出通報」「送達後台」兩筆，時間為**台北時間**，操作者為**自己的信箱** |
| 產生 CIOMS-I | 草稿欄位與通報內容一致 |
| 內部工作 | 個案頁按「**內部工作**」→ 編輯器打開；負責人選自己、內部工作到期日填今天 → 儲存。工作台切到「今日」看得到這筆（PR 4 修好的「新個案建不了第一筆工作」） |
| pvlink 後台 | 也看得到這筆（共用資料庫，這是預期的） |

### 驗離線補送

1. 手機開飛航模式，再送一筆同樣標示【測試】的個案 → 應顯示「目前無法連線，已存入待補送佇列，恢復網路後會自動送出」，
   完成畫面說明個案編號「送達後由系統配發」。
2. 關掉飛航模式、重開頁面 → 待補送筆數歸零；「我的通報紀錄」出現這筆，帶有系統配發的編號。

### 收尾

兩筆測試個案都在後台處理掉，擇一：

- 按「**標記不成案**」，或
- 按「**刪除個案**」，理由填「測試資料」。

刪除是軟刪除：個案從收件匣消失，但資料列與稽核軌跡留在資料庫，這是刻意的。不要用 D1 指令刪。

**階段 2 通過條件**：後台檢查清單與離線補送全部符合；測試個案已標記不成案或軟刪除。

---

## 階段 3　加業務之前的決定：`/api/sync`（已決定）

業務一加進 Access，原本就能直接呼叫 `/api/sync` 在同步用的 `DB` 存一份**自己的**快照。
已決定**先限制為 PV 再加業務**：[#9](https://github.com/bounce12340/pv-signal-monitor/pull/9) 讓 `/api/sync*` 與 `/llm/*`
走同一道 PV 檢查，身分只取驗證過的 Access JWT，且已合併進 `main`——階段 1 部署的就是這個版本，這一階段不必另外動作。

**階段 3 通過條件**：階段 1 的「雲端同步」檢查通過；業務被擋的部分在階段 4 驗。

---

## 階段 4　一個測試業務帳號，驗角色分權

這一步是「業務看不到別人個案、用不了 LLM」的唯一實證，不能跳過。需要一個**不在** `AE_PV_EMAILS`、
`ae_users` 也不是 `pv` 的真實個人公司信箱（例如請一位業務協助）。

1. pv.uic-ai.com 的 Access policy **逐一加入**這個信箱（不可用網域規則）。
2. 用這個帳號在手機上驗證：

| 檢查 | 怎麼做 | 預期 |
|---|---|---|
| 首頁也只給表單 | 開 `https://pv.uic-ai.com/`（不帶 `#/report`） | 先「通報者基本資料」（若未填過），之後**只有通報表單**，進不了主系統 |
| 角色 | 開 `https://pv.uic-ai.com/api/me` | `"role":"rep"` |
| LLM 被擋 | 開 `https://pv.uic-ai.com/llm/v1/models` | `{"error":"forbidden: requires PV role"}`（HTTP 403） |
| 同步被擋 | 開 `https://pv.uic-ai.com/api/sync/latest` | `{"error":"forbidden: requires PV role"}`（HTTP 403） |
| 只看得到自己的 | 送一筆【測試】個案後，開 `https://pv.uic-ai.com/api/ae-reports` | `cases` 只有自己送的個案。這一項驗的是後端，比畫面可靠 |
| 我的通報紀錄 | 表單右上角 →「我的通報紀錄」 | 只有自己送的那一筆 |
| 稽核操作者 | 藥安帳號在後台開這筆個案的稽核軌跡 | 操作者是**測試業務的信箱** |
| （可選）第二位業務 | 請第二位業務也送一筆 | 第一位業務在「我的通報紀錄」與 `/api/ae-reports` 都看不到第二筆 |

3. 收尾：藥安在後台把這些測試個案標記不成案或軟刪除（理由「測試資料」）。

**階段 4 通過條件**：上表全部符合預期。任何一項不符合就停在這裡，從 Access 移除測試帳號。

---

## 階段 5　全體業務加入 Access

1. pv.uic-ai.com 的 Access policy **逐一加入**每位業務的個人公司信箱。
   不可用 `Emails ending in @公司網域`，也不可加入私人信箱網域規則。
2. 通知業務：
   - 新網址 `https://pv.uic-ai.com/#/report`，請加入書籤或主畫面。
   - 首次登入若出現「通報者基本資料」就填完（PV-Link 上填過的會直接沿用）。
   - 從某個時間點起只用新網址；在那之前先完成階段 6 的檢查。
3. 離職流程補上一條：從 pv.uic-ai.com 的 Access policy 移除該信箱；若是藥安，一併移出 `AE_PV_EMAILS`（重新 `secret put`）與 `ae_users`。

從這一刻起到階段 7 完成前，兩個網址並行，pvlink 送出的個案仍可能重號——盡快走完階段 6、7。

**階段 5 通過條件**：名單只有逐一列舉的個人信箱；至少一位真實業務已從新網址成功送出。

---

## 階段 6　清空 PV-Link 的待補送佇列

PV-Link 的離線佇列與表單草稿存在每支手機瀏覽器的 `pvlink.uic-ai.com` 網域底下，**不會**跟著搬到 pv.uic-ai.com。
階段 7 轉址後，舊網址的頁面再也打不開，佇列裡的個案就永遠送不出去。

請每位業務在轉址前：

1. 用手機打開 `https://pvlink.uic-ai.com/#/report`。
2. 確認畫面上**沒有**「N 筆待補送」的提示。有的話，連上網路等它補送完成，再確認一次。
3. 若有寫到一半、還沒送出的表單草稿，先送出，或改到新網址重填。
4. 關掉 pvlink 的分頁，之後只用新網址。

在階段 7 動手前，確認每一位業務都回覆完成。

**階段 6 通過條件**：所有業務都回報沒有待補送、沒有未送出草稿。

---

## 階段 7　`pvlink.uic-ai.com` 轉址

在 Cloudflare 後台 uic-ai.com 這個 zone → Rules → Redirect Rules，新增一條 Single Redirect：

| 設定 | 值 |
|---|---|
| 條件 | `http.host eq "pvlink.uic-ai.com"`（整個主機名稱，含 `/api*`） |
| 類型 | Static |
| 目標 URL | `https://pv.uic-ai.com/` |
| 狀態碼 | **先用 302**，穩定後再改 301 |
| 保留查詢字串 | 關閉 |

為什麼這樣設：

- **目標用 `/`，不帶 `#/report`**：`components/ae/Root.tsx` 對業務不論哪個 hash 都只給通報表單，藥安則進主系統——
  帶 `#/report` 反而會讓藥安舊書籤落在表單上。Cloudflare 文件也沒有說明目標 URL 能否帶 `#` 片段，不帶就不用賭。
- **先 302**：瀏覽器會長期快取 301，設錯了很難收回。觀察至少一個完整工作週沒問題再改。
- **Single Redirects 在 Cloudflare 的第一個請求階段執行**，早於 Access 檢查，也早於 Worker 路由 `pvlink.uic-ai.com/api*`。
  所以舊頁面與舊 API 都會被轉走，未登入的人也會直接被帶到 pv.uic-ai.com，由那裡的 Access 把關。
  舊 API 的 `POST` 被 302 轉走後會變成 `GET`（跨網域也不會帶上憑證），**送不進去**——這就是階段 6 必須先做完的原因。

驗證：

```bash
curl -sI https://pvlink.uic-ai.com/ | grep -i -E '^(HTTP|location)'
curl -sI https://pvlink.uic-ai.com/api/ae-reports | grep -i -E '^(HTTP|location)'
# 兩個都應是 302，location: https://pv.uic-ai.com/
```

再用一支業務手機開舊書籤，確認落在新網址的通報表單。

回復：在 Redirect Rules 停用這條規則即可，pvlink 立刻恢復原狀（階段 8 之前）。

**階段 7 通過條件**：兩個 `curl` 都符合；業務手機實測通過。

---

## 階段 8　撤除 PV-Link（不可逆）

建議在階段 7 穩定至少一個完整工作週後再做。這一步刪掉的東西救不回來。

### 絕對不要刪

下面三項現在是 **pv-signal-monitor 的綁定**，名字雖然有 `pv-link`，刪了就是刪掉正式的個案、附件與速率限制：

- D1 `pv-link-ae`
- R2 `pv-link-ae-attachments`
- KV `RATE_LIMIT`（id `f335d67ab7e7432ca69dc181224bb535`）

刪 Worker 或 Pages 專案不會連帶刪除它們綁定的 D1／R2／KV，但刪除時的確認畫面請看清楚，只刪專案本身。

### 步驟

1. **Worker `pv-link-llm-proxy`**（路由 `pvlink.uic-ai.com/api*`）：Workers & Pages → `pv-link-llm-proxy` → Settings → Delete。
   它的 secret（`AE_PV_EMAILS`、`LLM_API_KEY`）會一起消失。若 `LLM_API_KEY` 是獨立申請的金鑰，到供應商那邊撤銷；
   **若它和 pv-signal-monitor 的 `OLLAMA_API_KEY` 是同一把，不要撤銷**，否則 pv.uic-ai.com 的 AI 功能會一起壞掉。
2. **先保住轉址要用的 DNS 紀錄**：Single Redirect 只對經 Cloudflare 代理（橘色雲朵）的主機名稱生效。
   `pvlink` 目前是 Pages 自動建立、指向 `pv-link-auditor.pages.dev` 的 CNAME；依 Pages 文件，解除自訂網域要刪掉這筆 CNAME。
   刪之前先決定 `pvlink` 改用什麼代理紀錄——常見做法是一筆**已代理**的 `AAAA pvlink → 100::`（不指向任何實際主機）。
   ⚠️ 這個做法本清單未在 Cloudflare 文件中查到出處（待查證）；換完後務必重跑階段 7 的兩個 `curl`，仍是 302 才繼續。
3. **Pages 專案 `pv-link-auditor`**：依 Pages 文件先解除自訂網域（DNS 刪 CNAME → 專案 Custom domains → Remove domain），
   再刪除整個專案。這同時關掉 `pv-link-auditor.pages.dev` 與所有 PR 預覽網址——它們一直沒有 Access 保護。
4. **pvlink 的 Access application**：轉址早於 Access 執行，這個 application 已經用不到，可以刪除。
5. 驗證：

```bash
curl -sI https://pv-link-auditor.pages.dev/ | head -1      # 不應再是 200
curl -sI https://pvlink.uic-ai.com/ | grep -i '^location'  # 仍導向 https://pv.uic-ai.com/
```

再開一次 pv.uic-ai.com 的「通報收案」，確認個案與附件都還在（確認沒誤刪共用資源）。

**階段 8 通過條件**：pages.dev 不再提供頁面；pvlink 仍轉址；pv.uic-ai.com 的個案與附件完好。

---

## 階段 9　收尾

- **重號**：重跑 0-8 的唯讀查詢（要看個案 id 時用 [`ae-integration-plan.md`](ae-integration-plan.md)「已知缺口」裡的完整查詢）。
  pvlink 撤除後就不會再新增重號。既有重號由藥安逐案決定是否更正、怎麼留下更正紀錄——
  編號可能已寫進送主管機關的報告，不能自動改號；若要改，另開功能經 API 留稽核軌跡，不直接改 D1。
- **唯一限制**：重號清完後，可以請我寫一個 `UNIQUE(case_number)` 的 migration；仍是備份後手動套用，CI 不跑。
- **301**：階段 7 穩定後把轉址改成 301。
- **文件**：[`ae-integration-plan.md`](ae-integration-plan.md) 進度表第 5 列改為完成，填上切換日期。

---

## 回復速查

| 狀況 | 回復方式 | 適用階段 |
|---|---|---|
| 新版 Worker 有問題 | `npx wrangler rollback <0-1 的 version ID> --message "..."` | 1 之後 |
| 業務不該進來 | 從 Access policy 移除該信箱 | 4、5 |
| 轉址有問題 | 停用 Redirect Rule | 7（階段 8 之前 pvlink 可完全恢復） |
| D1 資料被誤改 | `npx wrangler d1 time-travel restore pv-link-ae --bookmark=<0-2 記下的 bookmark>`，或以 0-2 的 `.sql` 備份處理 | 任何時候；⚠️ 回復會蓋掉 bookmark 之後的所有寫入（含真實個案），先與藥安確認 |
| Pages／PV-Link Worker 已刪 | 無法回復 | 8 |
