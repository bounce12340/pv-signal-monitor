// MedDRA 對照層（種子詞典）。
//
// ⚠️ 完整 MedDRA 是 ICH 授權的專有詞典，無法內建於開源前端。
// 本模組提供「常見 PV 首選術語(PT) → 系統器官分類(SOC)」的種子對照，用途：
//   1) 離線校驗 AI 猜測的 meddra_pt_candidate 是否為已知詞條（matched 標記）；
//   2) 補上對應的 SOC，讓訊號聚合能按器官系統分群。
// 使用者可自行擴充 MEDDRA_SEED，或改接授權的 MedDRA API / MSSO 詞典檔。
//
// 涵蓋範圍：常見 PV 事件，橫跨全部 27 個 MedDRA SOC（廣度補齊，通用監測）。
// 每個 SOC 的字串在組內須完全一致（訊號聚合以 SOC 字串分群，拼字不一會裂群）。

export interface MeddraSeedEntry {
  pt: string;         // 首選術語 (Preferred Term)
  soc: string;        // 系統器官分類 (System Organ Class)
  synonyms?: string[]; // 常見別名 / LLT 級別的口語說法 / 美式拼法變體
}

export interface MeddraLookupResult {
  input: string;
  pt: string;         // 命中時為標準 PT，未命中回原字串
  soc: string | null;
  matched: boolean;   // 是否命中種子詞典
}

// SOC 名稱常數：確保同一 SOC 的字串完全一致。
const SOC_BLOOD = 'Blood and lymphatic system disorders';
const SOC_CARDIAC = 'Cardiac disorders';
const SOC_CONGENITAL = 'Congenital, familial and genetic disorders';
const SOC_EAR = 'Ear and labyrinth disorders';
const SOC_ENDOCRINE = 'Endocrine disorders';
const SOC_EYE = 'Eye disorders';
const SOC_GI = 'Gastrointestinal disorders';
const SOC_GENERAL = 'General disorders and administration site conditions';
const SOC_HEPATO = 'Hepatobiliary disorders';
const SOC_IMMUNE = 'Immune system disorders';
const SOC_INFECTION = 'Infections and infestations';
const SOC_INJURY = 'Injury, poisoning and procedural complications';
const SOC_INVEST = 'Investigations';
const SOC_METABOLISM = 'Metabolism and nutrition disorders';
const SOC_MUSCULO = 'Musculoskeletal and connective tissue disorders';
const SOC_NEOPLASM = 'Neoplasms benign, malignant and unspecified (incl cysts and polyps)';
const SOC_NERVOUS = 'Nervous system disorders';
const SOC_PREGNANCY = 'Pregnancy, puerperium and perinatal conditions';
const SOC_PRODUCT = 'Product issues';
const SOC_PSYCH = 'Psychiatric disorders';
const SOC_RENAL = 'Renal and urinary disorders';
const SOC_REPRO = 'Reproductive system and breast disorders';
const SOC_RESP = 'Respiratory, thoracic and mediastinal disorders';
const SOC_SKIN = 'Skin and subcutaneous tissue disorders';
const SOC_SOCIAL = 'Social circumstances';
const SOC_SURGICAL = 'Surgical and medical procedures';
const SOC_VASCULAR = 'Vascular disorders';

export const MEDDRA_SEED: MeddraSeedEntry[] = [
  // ── Blood and lymphatic system disorders ──
  { pt: 'Thrombocytopenia', soc: SOC_BLOOD, synonyms: ['血小板低下', '血小板減少'] },
  { pt: 'Agranulocytosis', soc: SOC_BLOOD, synonyms: ['顆粒球缺乏'] },
  { pt: 'Anaemia', soc: SOC_BLOOD, synonyms: ['anemia', '貧血'] },
  { pt: 'Neutropenia', soc: SOC_BLOOD, synonyms: ['嗜中性球低下'] },
  { pt: 'Leukopenia', soc: SOC_BLOOD, synonyms: ['leucopenia', '白血球低下', '白血球減少'] },
  { pt: 'Pancytopenia', soc: SOC_BLOOD, synonyms: ['全血球減少'] },
  { pt: 'Eosinophilia', soc: SOC_BLOOD, synonyms: ['嗜酸性球增多'] },
  { pt: 'Haemolytic anaemia', soc: SOC_BLOOD, synonyms: ['hemolytic anemia', '溶血性貧血'] },
  { pt: 'Disseminated intravascular coagulation', soc: SOC_BLOOD, synonyms: ['dic', '瀰漫性血管內凝血'] },

  // ── Cardiac disorders ──
  { pt: 'Torsade de pointes', soc: SOC_CARDIAC, synonyms: ['尖端扭轉性心室頻脈'] },
  { pt: 'Myocardial infarction', soc: SOC_CARDIAC, synonyms: ['heart attack', '心肌梗塞'] },
  { pt: 'Bradycardia', soc: SOC_CARDIAC, synonyms: ['心搏過緩'] },
  { pt: 'Tachycardia', soc: SOC_CARDIAC, synonyms: ['心搏過速'] },
  { pt: 'Cardiac failure', soc: SOC_CARDIAC, synonyms: ['heart failure', '心臟衰竭', '心衰竭'] },
  { pt: 'Atrial fibrillation', soc: SOC_CARDIAC, synonyms: ['af', '心房顫動'] },
  { pt: 'Palpitations', soc: SOC_CARDIAC, synonyms: ['心悸'] },
  { pt: 'Cardiac arrest', soc: SOC_CARDIAC, synonyms: ['心跳停止', '心搏停止'] },
  { pt: 'Angina pectoris', soc: SOC_CARDIAC, synonyms: ['angina', '心絞痛'] },
  { pt: 'Ventricular tachycardia', soc: SOC_CARDIAC, synonyms: ['室性心動過速', '心室頻脈'] },

  // ── Congenital, familial and genetic disorders ──
  { pt: 'Congenital anomaly', soc: SOC_CONGENITAL, synonyms: ['congenital malformation', 'birth defect', '先天異常', '先天畸形'] },
  { pt: 'Cardiac malformation congenital', soc: SOC_CONGENITAL, synonyms: ['先天性心臟畸形'] },

  // ── Ear and labyrinth disorders ──
  { pt: 'Vertigo', soc: SOC_EAR, synonyms: ['眩暈'] },
  { pt: 'Tinnitus', soc: SOC_EAR, synonyms: ['耳鳴'] },
  { pt: 'Deafness', soc: SOC_EAR, synonyms: ['hearing loss', 'hypoacusis', '聽力喪失', '失聰'] },
  { pt: 'Ear pain', soc: SOC_EAR, synonyms: ['耳痛'] },

  // ── Endocrine disorders ──
  { pt: 'Hypothyroidism', soc: SOC_ENDOCRINE, synonyms: ['甲狀腺功能低下', '甲狀腺低下'] },
  { pt: 'Hyperthyroidism', soc: SOC_ENDOCRINE, synonyms: ['甲狀腺功能亢進', '甲狀腺亢進'] },
  { pt: 'Adrenal insufficiency', soc: SOC_ENDOCRINE, synonyms: ['腎上腺功能不全'] },
  { pt: 'Inappropriate antidiuretic hormone secretion', soc: SOC_ENDOCRINE, synonyms: ['siadh', '抗利尿激素分泌不當'] },

  // ── Eye disorders ──
  { pt: 'Vision blurred', soc: SOC_EYE, synonyms: ['blurred vision', '視力模糊'] },
  { pt: 'Visual impairment', soc: SOC_EYE, synonyms: ['視力障礙', '視力受損'] },
  { pt: 'Diplopia', soc: SOC_EYE, synonyms: ['double vision', '複視'] },
  { pt: 'Conjunctivitis', soc: SOC_EYE, synonyms: ['結膜炎'] },
  { pt: 'Dry eye', soc: SOC_EYE, synonyms: ['乾眼', '乾眼症'] },
  { pt: 'Optic neuropathy', soc: SOC_EYE, synonyms: ['視神經病變'] },

  // ── Gastrointestinal disorders ──
  { pt: 'Pancreatitis', soc: SOC_GI, synonyms: ['胰臟炎', '胰腺炎'] },
  { pt: 'Nausea', soc: SOC_GI, synonyms: ['噁心'] },
  { pt: 'Vomiting', soc: SOC_GI, synonyms: ['嘔吐'] },
  { pt: 'Diarrhoea', soc: SOC_GI, synonyms: ['diarrhea', '腹瀉'] },
  { pt: 'Abdominal pain', soc: SOC_GI, synonyms: ['腹痛'] },
  { pt: 'Gastrointestinal haemorrhage', soc: SOC_GI, synonyms: ['gi bleeding', 'gastrointestinal hemorrhage', '腸胃道出血'] },
  { pt: 'Constipation', soc: SOC_GI, synonyms: ['便秘'] },
  { pt: 'Dyspepsia', soc: SOC_GI, synonyms: ['indigestion', '消化不良'] },
  { pt: 'Gastritis', soc: SOC_GI, synonyms: ['胃炎'] },
  { pt: 'Peptic ulcer', soc: SOC_GI, synonyms: ['消化性潰瘍', '胃潰瘍'] },
  { pt: 'Dry mouth', soc: SOC_GI, synonyms: ['xerostomia', '口乾'] },
  { pt: 'Stomatitis', soc: SOC_GI, synonyms: ['口腔炎', '口內炎'] },

  // ── General disorders and administration site conditions ──
  { pt: 'Pyrexia', soc: SOC_GENERAL, synonyms: ['fever', '發燒', '發熱'] },
  { pt: 'Fatigue', soc: SOC_GENERAL, synonyms: ['疲勞', '疲倦'] },
  { pt: 'Asthenia', soc: SOC_GENERAL, synonyms: ['weakness', '虛弱', '無力'] },
  { pt: 'Oedema peripheral', soc: SOC_GENERAL, synonyms: ['peripheral edema', 'peripheral oedema', '周邊水腫', '下肢水腫'] },
  { pt: 'Chest pain', soc: SOC_GENERAL, synonyms: ['胸痛'] },
  { pt: 'Malaise', soc: SOC_GENERAL, synonyms: ['不適', '倦怠'] },
  { pt: 'Death', soc: SOC_GENERAL, synonyms: ['死亡'] },
  { pt: 'Sudden death', soc: SOC_GENERAL, synonyms: ['猝死'] },
  { pt: 'Injection site reaction', soc: SOC_GENERAL, synonyms: ['注射部位反應'] },
  { pt: 'Drug ineffective', soc: SOC_GENERAL, synonyms: ['lack of efficacy', '藥物無效', '療效不佳'] },
  { pt: 'Multiple organ dysfunction syndrome', soc: SOC_GENERAL, synonyms: ['multi-organ failure', '多重器官衰竭', '多重器官功能障礙'] },
  { pt: 'Oedema', soc: SOC_GENERAL, synonyms: ['edema', '水腫'] },

  // ── Hepatobiliary disorders ──
  { pt: 'Hepatotoxicity', soc: SOC_HEPATO, synonyms: ['liver toxicity', '肝毒性'] },
  { pt: 'Hepatic failure', soc: SOC_HEPATO, synonyms: ['liver failure', '肝衰竭'] },
  { pt: 'Cholelithiasis', soc: SOC_HEPATO, synonyms: ['gallstones', '膽結石'] },
  { pt: 'Cholestasis', soc: SOC_HEPATO, synonyms: ['膽汁鬱積'] },
  { pt: 'Jaundice', soc: SOC_HEPATO, synonyms: ['黃疸'] },
  { pt: 'Hepatitis', soc: SOC_HEPATO, synonyms: ['肝炎'] },
  { pt: 'Autoimmune hepatitis', soc: SOC_HEPATO, synonyms: ['自體免疫性肝炎', '自身免疫性肝炎'] },
  { pt: 'Drug-induced liver injury', soc: SOC_HEPATO, synonyms: ['dili', '藥物性肝損傷'] },
  { pt: 'Hyperbilirubinaemia', soc: SOC_HEPATO, synonyms: ['hyperbilirubinemia', '高膽紅素血症'] },

  // ── Immune system disorders ──
  { pt: 'Anaphylactic reaction', soc: SOC_IMMUNE, synonyms: ['anaphylaxis', '過敏反應'] },
  { pt: 'Anaphylactic shock', soc: SOC_IMMUNE, synonyms: ['過敏性休克'] },
  { pt: 'Hypersensitivity', soc: SOC_IMMUNE, synonyms: ['過敏', '超敏反應'] },
  { pt: 'Drug hypersensitivity', soc: SOC_IMMUNE, synonyms: ['藥物過敏'] },

  // ── Infections and infestations ──
  { pt: 'Pneumonia', soc: SOC_INFECTION, synonyms: ['肺炎'] },
  { pt: 'Sepsis', soc: SOC_INFECTION, synonyms: ['敗血症'] },
  { pt: 'Urinary tract infection', soc: SOC_INFECTION, synonyms: ['uti', '泌尿道感染'] },
  { pt: 'Upper respiratory tract infection', soc: SOC_INFECTION, synonyms: ['urti', '上呼吸道感染'] },
  { pt: 'Cellulitis', soc: SOC_INFECTION, synonyms: ['蜂窩性組織炎'] },
  { pt: 'Septic shock', soc: SOC_INFECTION, synonyms: ['敗血性休克'] },

  // ── Injury, poisoning and procedural complications ──
  { pt: 'Overdose', soc: SOC_INJURY, synonyms: ['過量', '用藥過量'] },
  { pt: 'Fall', soc: SOC_INJURY, synonyms: ['跌倒'] },
  { pt: 'Drug interaction', soc: SOC_INJURY, synonyms: ['drug-drug interaction', '藥物交互作用', '藥物交互作用'] },
  { pt: 'Medication error', soc: SOC_INJURY, synonyms: ['用藥錯誤', '給藥錯誤'] },
  { pt: 'Toxicity to various agents', soc: SOC_INJURY, synonyms: ['toxicity', '毒性反應'] },
  { pt: 'Accidental overdose', soc: SOC_INJURY, synonyms: ['意外過量'] },

  // ── Investigations ──
  { pt: 'Blood creatine phosphokinase increased', soc: SOC_INVEST, synonyms: ['cpk increased', 'ck increased', 'creatine kinase increased', 'cpk 上升'] },
  { pt: 'Hepatic enzyme increased', soc: SOC_INVEST, synonyms: ['increased hepatic enzymes', 'elevated liver enzymes', 'alt increased', 'ast increased', '肝酵素上升'] },
  { pt: 'Blood creatinine increased', soc: SOC_INVEST, synonyms: ['creatinine increased', '肌酸酐上升'] },
  { pt: 'Transaminases increased', soc: SOC_INVEST, synonyms: ['transaminitis'] },
  { pt: 'Electrocardiogram QT prolonged', soc: SOC_INVEST, synonyms: ['qt prolongation', 'qt prolonged', 'qt 延長'] },
  { pt: 'Weight increased', soc: SOC_INVEST, synonyms: ['weight gain', '體重增加'] },
  { pt: 'Weight decreased', soc: SOC_INVEST, synonyms: ['weight loss', '體重減輕'] },
  { pt: 'International normalised ratio increased', soc: SOC_INVEST, synonyms: ['inr increased', 'inr 上升'] },
  { pt: 'Platelet count decreased', soc: SOC_INVEST, synonyms: ['血小板計數下降'] },
  { pt: 'Liver function test increased', soc: SOC_INVEST, synonyms: ['lft increased', 'abnormal liver function test', '肝功能異常'] },
  { pt: 'Blood pressure increased', soc: SOC_INVEST, synonyms: ['血壓上升'] },

  // ── Metabolism and nutrition disorders ──
  { pt: 'Hyperglycaemia', soc: SOC_METABOLISM, synonyms: ['hyperglycemia', '高血糖'] },
  { pt: 'Hypoglycaemia', soc: SOC_METABOLISM, synonyms: ['hypoglycemia', '低血糖'] },
  { pt: 'Hyperkalaemia', soc: SOC_METABOLISM, synonyms: ['hyperkalemia', '高血鉀'] },
  { pt: 'Hypokalaemia', soc: SOC_METABOLISM, synonyms: ['hypokalemia', '低血鉀'] },
  { pt: 'Hyponatraemia', soc: SOC_METABOLISM, synonyms: ['hyponatremia', '低血鈉'] },
  { pt: 'Dehydration', soc: SOC_METABOLISM, synonyms: ['脫水'] },
  { pt: 'Decreased appetite', soc: SOC_METABOLISM, synonyms: ['anorexia', '食慾不振', '食慾下降'] },
  { pt: 'Metabolic acidosis', soc: SOC_METABOLISM, synonyms: ['代謝性酸中毒'] },
  { pt: 'Hyperuricaemia', soc: SOC_METABOLISM, synonyms: ['hyperuricemia', '高尿酸血症'] },
  { pt: 'Lactic acidosis', soc: SOC_METABOLISM, synonyms: ['乳酸中毒', '乳酸性酸中毒'] },

  // ── Musculoskeletal and connective tissue disorders ──
  { pt: 'Rhabdomyolysis', soc: SOC_MUSCULO, synonyms: ['橫紋肌溶解'] },
  { pt: 'Myalgia', soc: SOC_MUSCULO, synonyms: ['muscle pain', '肌肉疼痛', '肌痛'] },
  { pt: 'Myopathy', soc: SOC_MUSCULO, synonyms: ['肌病變'] },
  { pt: 'Muscular weakness', soc: SOC_MUSCULO, synonyms: ['肌無力'] },
  { pt: 'Arthralgia', soc: SOC_MUSCULO, synonyms: ['joint pain', '關節痛'] },
  { pt: 'Back pain', soc: SOC_MUSCULO, synonyms: ['背痛'] },
  { pt: 'Muscle spasms', soc: SOC_MUSCULO, synonyms: ['muscle cramp', '肌肉痙攣', '抽筋'] },

  // ── Neoplasms benign, malignant and unspecified ──
  { pt: 'Malignant neoplasm progression', soc: SOC_NEOPLASM, synonyms: ['腫瘤惡化', '腫瘤進展'] },
  { pt: 'Hepatic neoplasm', soc: SOC_NEOPLASM, synonyms: ['liver tumour', '肝腫瘤'] },
  { pt: 'Lymphoma', soc: SOC_NEOPLASM, synonyms: ['淋巴瘤'] },
  { pt: 'Squamous cell carcinoma', soc: SOC_NEOPLASM, synonyms: ['鱗狀細胞癌'] },

  // ── Nervous system disorders ──
  { pt: 'Headache', soc: SOC_NERVOUS, synonyms: ['頭痛'] },
  { pt: 'Dizziness', soc: SOC_NERVOUS, synonyms: ['頭暈'] },
  { pt: 'Seizure', soc: SOC_NERVOUS, synonyms: ['convulsion', '癲癇發作', '抽搐'] },
  { pt: 'Syncope', soc: SOC_NERVOUS, synonyms: ['暈厥'] },
  { pt: 'Paraesthesia', soc: SOC_NERVOUS, synonyms: ['paresthesia', '感覺異常', '麻木'] },
  { pt: 'Tremor', soc: SOC_NERVOUS, synonyms: ['顫抖', '震顫'] },
  { pt: 'Somnolence', soc: SOC_NERVOUS, synonyms: ['drowsiness', '嗜睡'] },
  { pt: 'Peripheral neuropathy', soc: SOC_NERVOUS, synonyms: ['周邊神經病變', '末梢神經病變'] },
  { pt: 'Dysgeusia', soc: SOC_NERVOUS, synonyms: ['taste disturbance', '味覺障礙'] },
  { pt: 'Cerebrovascular accident', soc: SOC_NERVOUS, synonyms: ['stroke', 'cva', '腦中風', '腦血管意外'] },

  // ── Pregnancy, puerperium and perinatal conditions ──
  { pt: 'Abortion spontaneous', soc: SOC_PREGNANCY, synonyms: ['miscarriage', '自然流產', '流產'] },
  { pt: 'Foetal exposure during pregnancy', soc: SOC_PREGNANCY, synonyms: ['fetal exposure', '胎兒暴露'] },
  { pt: 'Premature baby', soc: SOC_PREGNANCY, synonyms: ['premature birth', '早產'] },

  // ── Product issues ──
  { pt: 'Device malfunction', soc: SOC_PRODUCT, synonyms: ['裝置故障', '器材故障'] },
  { pt: 'Product quality issue', soc: SOC_PRODUCT, synonyms: ['產品品質問題'] },

  // ── Psychiatric disorders ──
  { pt: 'Depression', soc: SOC_PSYCH, synonyms: ['憂鬱', '抑鬱'] },
  { pt: 'Anxiety', soc: SOC_PSYCH, synonyms: ['焦慮'] },
  { pt: 'Insomnia', soc: SOC_PSYCH, synonyms: ['失眠'] },
  { pt: 'Confusional state', soc: SOC_PSYCH, synonyms: ['confusion', '意識混亂', '精神混亂'] },
  { pt: 'Hallucination', soc: SOC_PSYCH, synonyms: ['幻覺'] },
  { pt: 'Suicidal ideation', soc: SOC_PSYCH, synonyms: ['自殺意念'] },
  { pt: 'Agitation', soc: SOC_PSYCH, synonyms: ['躁動', '激動'] },

  // ── Renal and urinary disorders ──
  { pt: 'Acute kidney injury', soc: SOC_RENAL, synonyms: ['aki', 'acute renal failure', '急性腎損傷', '急性腎衰竭'] },
  { pt: 'Renal failure', soc: SOC_RENAL, synonyms: ['腎衰竭'] },
  { pt: 'Proteinuria', soc: SOC_RENAL, synonyms: ['蛋白尿'] },
  { pt: 'Haematuria', soc: SOC_RENAL, synonyms: ['hematuria', '血尿'] },
  { pt: 'Nephrolithiasis', soc: SOC_RENAL, synonyms: ['kidney stone', '腎結石'] },
  { pt: 'Tubulointerstitial nephritis', soc: SOC_RENAL, synonyms: ['interstitial nephritis', '間質性腎炎'] },

  // ── Reproductive system and breast disorders ──
  { pt: 'Erectile dysfunction', soc: SOC_REPRO, synonyms: ['勃起功能障礙', '陽痿'] },
  { pt: 'Gynaecomastia', soc: SOC_REPRO, synonyms: ['gynecomastia', '男性乳房發育'] },
  { pt: 'Menstruation irregular', soc: SOC_REPRO, synonyms: ['irregular menstruation', '月經不規則'] },
  { pt: 'Amenorrhoea', soc: SOC_REPRO, synonyms: ['amenorrhea', '無月經', '停經'] },

  // ── Respiratory, thoracic and mediastinal disorders ──
  { pt: 'Interstitial lung disease', soc: SOC_RESP, synonyms: ['ild', '間質性肺病'] },
  { pt: 'Dyspnoea', soc: SOC_RESP, synonyms: ['dyspnea', '呼吸困難'] },
  { pt: 'Pulmonary embolism', soc: SOC_RESP, synonyms: ['pe', '肺栓塞'] },
  { pt: 'Cough', soc: SOC_RESP, synonyms: ['咳嗽'] },
  { pt: 'Pneumonitis', soc: SOC_RESP, synonyms: ['肺臟炎'] },
  { pt: 'Bronchospasm', soc: SOC_RESP, synonyms: ['支氣管痙攣'] },
  { pt: 'Epistaxis', soc: SOC_RESP, synonyms: ['nosebleed', '鼻出血', '流鼻血'] },
  { pt: 'Pleural effusion', soc: SOC_RESP, synonyms: ['胸腔積液', '肋膜積液'] },
  { pt: 'Respiratory failure', soc: SOC_RESP, synonyms: ['呼吸衰竭'] },

  // ── Skin and subcutaneous tissue disorders ──
  { pt: 'Rash', soc: SOC_SKIN, synonyms: ['皮疹', '紅疹'] },
  { pt: 'Pruritus', soc: SOC_SKIN, synonyms: ['itching', '搔癢'] },
  { pt: 'Stevens-Johnson syndrome', soc: SOC_SKIN, synonyms: ['sjs', '史蒂芬強生症候群'] },
  { pt: 'Toxic epidermal necrolysis', soc: SOC_SKIN, synonyms: ['ten', '毒性表皮壞死溶解'] },
  { pt: 'Angioedema', soc: SOC_SKIN, synonyms: ['血管性水腫'] },
  { pt: 'Urticaria', soc: SOC_SKIN, synonyms: ['hives', '蕁麻疹'] },
  { pt: 'Alopecia', soc: SOC_SKIN, synonyms: ['hair loss', '脫髮', '禿髮'] },
  { pt: 'Photosensitivity reaction', soc: SOC_SKIN, synonyms: ['photosensitivity', '光敏感反應'] },
  { pt: 'Erythema', soc: SOC_SKIN, synonyms: ['紅斑'] },
  { pt: 'Hyperhidrosis', soc: SOC_SKIN, synonyms: ['excessive sweating', '多汗', '盜汗'] },
  { pt: 'Drug reaction with eosinophilia and systemic symptoms', soc: SOC_SKIN, synonyms: ['dress syndrome', 'dress'] },
  { pt: 'Erythema multiforme', soc: SOC_SKIN, synonyms: ['多形性紅斑'] },

  // ── Social circumstances ──
  { pt: 'Alcohol use', soc: SOC_SOCIAL, synonyms: ['飲酒'] },

  // ── Surgical and medical procedures ──
  { pt: 'Dialysis', soc: SOC_SURGICAL, synonyms: ['洗腎', '透析'] },

  // ── Vascular disorders ──
  { pt: 'Hypertension', soc: SOC_VASCULAR, synonyms: ['高血壓'] },
  { pt: 'Hypotension', soc: SOC_VASCULAR, synonyms: ['低血壓'] },
  { pt: 'Deep vein thrombosis', soc: SOC_VASCULAR, synonyms: ['dvt', '深部靜脈栓塞'] },
  { pt: 'Flushing', soc: SOC_VASCULAR, synonyms: ['潮紅', '臉部潮紅'] },
  { pt: 'Thrombosis', soc: SOC_VASCULAR, synonyms: ['血栓', '血栓形成'] },
  { pt: 'Vasculitis', soc: SOC_VASCULAR, synonyms: ['血管炎'] },
  { pt: 'Haematoma', soc: SOC_VASCULAR, synonyms: ['hematoma', '血腫'] },
];

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

// 預先建索引：pt 與所有 synonyms 都指向該詞條。
const INDEX: Map<string, MeddraSeedEntry> = (() => {
  const m = new Map<string, MeddraSeedEntry>();
  for (const e of MEDDRA_SEED) {
    m.set(norm(e.pt), e);
    for (const syn of e.synonyms || []) m.set(norm(syn), e);
  }
  return m;
})();

/** 校驗並標準化一個 AI 猜測的 PT。命中種子詞典回標準 PT + SOC；否則 matched=false。 */
export function lookupMeddra(candidate: string | null | undefined): MeddraLookupResult {
  const input = (candidate || '').trim();
  if (!input) return { input, pt: '', soc: null, matched: false };
  const key = norm(input);
  const exact = INDEX.get(key);
  if (exact) return { input, pt: exact.pt, soc: exact.soc, matched: true };
  // 寬鬆比對：只接受「候選片語『包含』某個已知詞條」單一方向（候選較具體），
  // 不做反向（避免 "increased" 之類泛詞誤命中最長詞條）。多命中時取最長詞條（最具體）。
  if (key.length >= 5) {
    let best: { term: string; entry: MeddraSeedEntry } | null = null;
    for (const [term, entry] of INDEX) {
      if (term.length >= 5 && key.includes(term) && (!best || term.length > best.term.length)) {
        best = { term, entry };
      }
    }
    if (best) return { input, pt: best.entry.pt, soc: best.entry.soc, matched: true };
  }
  return { input, pt: input, soc: null, matched: false };
}
