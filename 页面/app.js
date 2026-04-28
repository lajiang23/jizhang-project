const STORAGE_KEY = "debt-ledger-mvp-v1";

const categoryTree = {
  生活往来: ["日常借款", "房租水电", "医疗教育"],
  经营周转: ["进货垫资", "项目预支", "现金周转"],
  家庭责任: ["亲友借贷", "家庭共同支出", "子女教育"],
  职业收入: ["工资垫付", "报销代垫", "劳务往来"],
  资产安排: ["信用负债", "分期付款", "其他投资往来"],
};

const defaultFilters = {
  direction: "all",
  status: "all",
  counterparty: "",
  category: "all",
  due: "all",
};

const formFieldConfig = [
  { name: "direction", label: "借贷方向", type: "select", options: ["我欠别人", "别人欠我"] },
  { name: "counterparty", label: "对象", type: "text", placeholder: "例如：张三" },
  { name: "principal", label: "本金", type: "number", placeholder: "0.00", step: "0.01" },
  { name: "currency", label: "币种", type: "select", options: ["CNY", "USD", "EUR", "JPY"] },
  { name: "occurredAt", label: "发生日期", type: "date" },
  { name: "dueDate", label: "到期日", type: "date" },
  { name: "status", label: "状态", type: "select", options: ["进行中", "已结清", "已逾期"] },
  { name: "category", label: "一级分类", type: "select", options: Object.keys(categoryTree) },
  { name: "subcategory", label: "二级分类", type: "select", options: [] },
  { name: "tags", label: "标签", type: "text", placeholder: "逗号分隔，例如 朋友,短期" },
  { name: "notes", label: "备注", type: "textarea", placeholder: "补充说明、借条内容、约定事项", full: true },
  { name: "attachmentName", label: "附件名", type: "text", placeholder: "手动录入可留空", full: true },
];

const demoData = [
  {
    id: crypto.randomUUID(),
    sourceType: "manual",
    direction: "我欠别人",
    counterparty: "李娜",
    principal: 18000,
    currency: "CNY",
    occurredAt: "2026-04-03",
    dueDate: "2026-08-15",
    status: "进行中",
    category: "生活往来",
    subcategory: "房租水电",
    tags: ["房租", "短期"],
    notes: "季度租金垫付，约定分四次归还。",
    attachmentName: "",
    attachments: [],
    importedMeta: null,
    payments: [{ id: crypto.randomUUID(), amount: 4500, date: "2026-04-15", note: "首期已还" }],
    plans: [
      {
        id: crypto.randomUUID(),
        mode: "suggested",
        totalAmount: 18000,
        frequency: "每月",
        rule: "均摊",
        installments: [
          installment("2026-05-15", 4500, false),
          installment("2026-06-15", 4500, false),
          installment("2026-07-15", 4500, false),
          installment("2026-08-15", 4500, false),
        ],
        adjustments: [],
      },
    ],
  },
  {
    id: crypto.randomUUID(),
    sourceType: "imported",
    direction: "别人欠我",
    counterparty: "杭州新澜贸易",
    principal: 32000,
    currency: "CNY",
    occurredAt: "2026-03-28",
    dueDate: "2026-06-30",
    status: "进行中",
    category: "经营周转",
    subcategory: "项目预支",
    tags: ["客户", "项目"],
    notes: "项目启动款代垫，凭证已上传。",
    attachmentName: "启动款截图.png",
    attachments: [{ name: "启动款截图.png", type: "image/png" }],
    importedMeta: {
      sourceType: "image",
      rawText: "杭州新澜贸易 启动款 32000 2026-03-28 6月30日前归还",
      confidence: 0.82,
      previewWarnings: ["对象名称与分类由 AI 归类推断，请复核。"],
    },
    payments: [],
    plans: [],
  },
];

let state = {
  debts: loadState(),
  selectedDebtId: null,
  activeMode: "manual",
  currentView: "workspace",
  editingId: null,
  filters: { ...defaultFilters },
  annualYear: new Date().getFullYear(),
  importDraft: null,
};

const formRefs = {};
const filterRefs = {};

const els = {
  heroMetrics: document.querySelector("#heroMetrics"),
  workspaceView: document.querySelector("#workspaceView"),
  annualView: document.querySelector("#annualView"),
  annualSummary: document.querySelector("#annualSummary"),
  annualMonthList: document.querySelector("#annualMonthList"),
  monthBars: document.querySelector("#monthBars"),
  annualYearSelect: document.querySelector("#annualYearSelect"),
  debtList: document.querySelector("#debtList"),
  detailBody: document.querySelector("#detailBody"),
  filterBar: document.querySelector("#filterBar"),
  debtForm: document.querySelector("#debtForm"),
  importPreview: document.querySelector("#importPreview"),
  importFile: document.querySelector("#importFile"),
  importStatus: document.querySelector("#importStatus"),
  parseFileButton: document.querySelector("#parseFileButton"),
  manualPanel: document.querySelector("#manualPanel"),
  importPanel: document.querySelector("#importPanel"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  seedDemoButton: document.querySelector("#seedDemoButton"),
  pageNavButtons: Array.from(document.querySelectorAll(".page-nav-button")),
  segmentedButtons: Array.from(document.querySelectorAll(".segmented-button")),
};

const FileParserService = {
  async parse(file) {
    const sourceType = inferSourceType(file);
    try {
      if (sourceType === "csv" || sourceType === "excel") {
        return await this.parseSpreadsheet(file, sourceType);
      }
      if (sourceType === "pdf") {
        return await this.parsePdf(file);
      }
      if (sourceType === "image") {
        return await this.parseImage(file);
      }
      return {
        sourceType,
        rawText: "",
        previewWarnings: ["暂不支持该格式，请改为手动录入。"],
      };
    } catch (error) {
      return {
        sourceType,
        rawText: "",
        previewWarnings: [`解析失败：${error.message}`],
      };
    }
  },

  async parseSpreadsheet(file, sourceType) {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonRows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
    const rawText = jsonRows
      .slice(0, 8)
      .map((row) => Object.values(row).join(" | "))
      .join("\n");

    const previewWarnings = jsonRows.length
      ? ["已从表格提取前几行内容，请确认金额、对象和方向。"]
      : ["表格内容为空，请检查文件。"];

    return { sourceType, rawText, previewWarnings };
  },

  async parsePdf(file) {
    const pdfjsLib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";
    const uint8 = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
    let rawText = "";
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      rawText += `${content.items.map((item) => item.str).join(" ")}\n`;
    }
    return {
      sourceType: "pdf",
      rawText: rawText.trim(),
      previewWarnings: rawText.trim()
        ? ["已从 PDF 抽取文本，扫描版 PDF 可能仍需人工修正。"]
        : ["未从 PDF 中提取到文本，可能是扫描件。"],
    };
  },

  async parseImage(file) {
    if (!window.Tesseract) {
      return {
        sourceType: "image",
        rawText: "",
        previewWarnings: ["OCR 组件未加载，请稍后重试。"],
      };
    }
    const result = await window.Tesseract.recognize(file, "chi_sim+eng");
    return {
      sourceType: "image",
      rawText: result.data.text.trim(),
      previewWarnings: result.data.text.trim()
        ? ["OCR 已完成，截图类凭证通常需要再确认对象和方向。"]
        : ["图片未识别到有效文字，请手动补录。"],
    };
  },
};

const ExtractionService = {
  extract({ sourceType, rawText, previewWarnings }) {
    const text = rawText || "";
    const amountMatch = text.match(/(?:人民币|￥|¥)?\s*([1-9]\d{0,6}(?:\.\d{1,2})?)/);
    const dateMatches = [...text.matchAll(/(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/g)];
    const peopleMatch = text.match(/(?:向|与|收自|付款给|借给|借款人|出借人)?([\u4e00-\u9fa5A-Za-z0-9]{2,18})(?:借款|归还|还款|贸易|公司|有限公司|款项)/);
    const dueHints = text.match(/(\d{1,2}月\d{1,2}日|20\d{2}[-./年]\d{1,2}[-./月]\d{1,2})前(?:归还|还款|结清)?/);

    const amount = amountMatch ? Number(amountMatch[1]) : "";
    const occurredAt = dateMatches[0] ? normalizeDateMatch(dateMatches[0]) : todayString();
    const dueDate = dueHints ? normalizeDateText(dueHints[1]) : dateMatches[1] ? normalizeDateMatch(dateMatches[1]) : "";
    const direction = inferDirection(text);
    const category = inferCategory(text, direction);
    const subcategory = categoryTree[category][0];
    const counterparty = peopleMatch ? cleanupCounterparty(peopleMatch[1]) : "";

    const extractedFields = {
      direction: { value: direction, confidence: direction ? 0.72 : 0.25 },
      counterparty: { value: counterparty, confidence: counterparty ? 0.58 : 0.2 },
      principal: { value: amount, confidence: amount ? 0.84 : 0.2 },
      currency: { value: "CNY", confidence: 0.95 },
      occurredAt: { value: occurredAt, confidence: 0.76 },
      dueDate: { value: dueDate, confidence: dueDate ? 0.66 : 0.36 },
      status: { value: "进行中", confidence: 0.95 },
      category: { value: category, confidence: 0.61 },
      subcategory: { value: subcategory, confidence: 0.53 },
      tags: { value: suggestTags(text, direction), confidence: 0.52 },
      notes: { value: summarizeText(text), confidence: 0.6 },
      attachmentName: { value: "", confidence: 1 },
      rawSummary: { value: summarizeText(text, 88), confidence: 0.74 },
    };

    const warnings = [...previewWarnings];
    if (!text.trim()) warnings.push("没有识别出原始文本，建议改为手动录入。");
    if (!amount) warnings.push("未可靠识别金额。");
    if (!counterparty) warnings.push("未可靠识别对象名。");
    if (!dueDate) warnings.push("未可靠识别还款日期。");

    return {
      sourceType,
      rawText: text,
      extractedFields,
      confidence: averageConfidence(extractedFields),
      previewWarnings: warnings,
    };
  },
};

const DebtService = {
  list() {
    return state.debts;
  },

  upsert(input) {
    const normalized = normalizeDebt(input);
    const idx = state.debts.findIndex((item) => item.id === normalized.id);
    if (idx >= 0) state.debts[idx] = normalized;
    else state.debts.unshift(normalized);
    persistState();
    return normalized;
  },

  remove(id) {
    state.debts = state.debts.filter((item) => item.id !== id);
    persistState();
  },

  find(id) {
    return state.debts.find((item) => item.id === id) || null;
  },
};

const RepaymentPlanService = {
  createManualPlan(debtId, payload) {
    const debt = DebtService.find(debtId);
    if (!debt) return null;
    const plan = {
      id: crypto.randomUUID(),
      mode: "manual",
      totalAmount: Number(payload.totalAmount),
      frequency: payload.frequency,
      rule: "手动",
      installments: buildInstallments(payload),
      adjustments: [],
    };
    debt.plans.unshift(plan);
    DebtService.upsert(debt);
    return plan;
  },

  generateSuggestedPlan(debtId, payload) {
    const debt = DebtService.find(debtId);
    if (!debt) return null;
    const plan = {
      id: crypto.randomUUID(),
      mode: "suggested",
      totalAmount: Number(payload.totalAmount),
      frequency: payload.frequency,
      rule: payload.rule,
      installments: buildSuggestedInstallments(payload),
      adjustments: [],
    };
    debt.plans.unshift(plan);
    DebtService.upsert(debt);
    return plan;
  },

  updateInstallment(debtId, planId, installmentId, changes) {
    const debt = DebtService.find(debtId);
    if (!debt) return;
    const plan = debt.plans.find((item) => item.id === planId);
    if (!plan) return;
    const installmentItem = plan.installments.find((item) => item.id === installmentId);
    if (!installmentItem) return;
    Object.assign(installmentItem, changes);
    plan.adjustments.unshift({
      id: crypto.randomUUID(),
      changedAt: new Date().toISOString(),
      note: `调整分期 ${installmentItem.date}`,
    });
    DebtService.upsert(debt);
  },

  markInstallmentPaid(debtId, planId, installmentId) {
    const debt = DebtService.find(debtId);
    if (!debt) return;
    const plan = debt.plans.find((item) => item.id === planId);
    const installmentItem = plan?.installments.find((item) => item.id === installmentId);
    if (!installmentItem) return;
    installmentItem.paid = !installmentItem.paid;
    if (installmentItem.paid) {
      debt.payments.unshift({
        id: crypto.randomUUID(),
        amount: Number(installmentItem.amount),
        date: installmentItem.date,
        note: `按计划还款 ${plan.frequency}`,
      });
    } else {
      debt.payments = debt.payments.filter(
        (item) => !(item.amount === Number(installmentItem.amount) && item.date === installmentItem.date),
      );
    }
    DebtService.upsert(debt);
  },
};

bootstrap();

function bootstrap() {
  syncAnnualYear();
  renderFilters();
  renderForm();
  bindEvents();
  render();
}

function bindEvents() {
  els.pageNavButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  els.segmentedButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  els.parseFileButton.addEventListener("click", onParseFile);
  els.clearSelectionButton.addEventListener("click", () => {
    state.selectedDebtId = null;
    state.editingId = null;
    resetForm();
    render();
  });
  els.seedDemoButton.addEventListener("click", () => {
    state.debts = demoData.map((item) => structuredClone(item));
    state.selectedDebtId = state.debts[0]?.id ?? null;
    syncAnnualYear();
    persistState();
    render();
  });
  els.annualYearSelect.addEventListener("change", () => {
    state.annualYear = Number(els.annualYearSelect.value);
    renderAnnualView();
  });
}

function render() {
  renderHero();
  renderViewState();
  if (state.currentView === "workspace") {
    renderDebtList();
    renderDetail();
    renderImportPreview();
    return;
  }
  renderAnnualView();
}

function renderHero() {
  const summary = summarizeDebts(state.debts);
  const cards = [
    { label: "记录数", value: `${summary.count}`, tone: "" },
    { label: "我欠别人", value: formatMoney(summary.borrowed), tone: "alert" },
    { label: "别人欠我", value: formatMoney(summary.lent), tone: "ok" },
    { label: "本月待处理", value: `${summary.dueSoon}`, tone: "warn" },
  ];
  els.heroMetrics.innerHTML = cards
    .map(
      (card) => `
        <article class="metric-card">
          <span class="status-pill ${card.tone}">${card.label}</span>
          <strong>${card.value}</strong>
        </article>
      `,
    )
    .join("");
}

function renderViewState() {
  const inWorkspace = state.currentView === "workspace";
  els.workspaceView.classList.toggle("hidden", !inWorkspace);
  els.annualView.classList.toggle("hidden", inWorkspace);
  els.pageNavButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.currentView);
  });
}

function renderAnnualView() {
  const years = availableYears();
  if (!years.includes(state.annualYear)) state.annualYear = years[0];
  populateYearSelect(years);
  const annual = buildAnnualLedger(state.annualYear);

  els.annualSummary.innerHTML = [
    { label: "年度发生总额", value: formatMoney(annual.totalOccurred) },
    { label: "年度已还总额", value: formatMoney(annual.totalPaid) },
    { label: "年度新增应收", value: formatMoney(annual.totalReceivable) },
    { label: "年度新增应还", value: formatMoney(annual.totalPayable) },
  ]
    .map(
      (item) => `
        <article class="annual-summary-card">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
        </article>
      `,
    )
    .join("");

  const maxMonthValue = Math.max(...annual.months.map((month) => month.occurredTotal), 1);
  els.monthBars.innerHTML = annual.months
    .map(
      (month) => `
        <div class="month-bar-row">
          <div class="month-bar-label">${month.label}</div>
          <div class="month-bar-track">
            <div class="month-bar-fill" style="width: ${(month.occurredTotal / maxMonthValue) * 100}%"></div>
          </div>
          <div class="month-bar-value">${formatCompactMoney(month.occurredTotal)}</div>
        </div>
      `,
    )
    .join("");

  els.annualMonthList.innerHTML = annual.months
    .map((month) => {
      const lines = month.lines.length
        ? month.lines
            .map(
              (line) => `
                <div class="annual-line-item">
                  <div class="kind">${line.kind}</div>
                  <div>
                    <div class="title">${escapeHtml(line.title)}</div>
                    <div class="sub">${escapeHtml(line.sub)}</div>
                  </div>
                  <div class="value ${line.directionClass}">${formatMoney(line.amount, line.currency)}</div>
                </div>
              `,
            )
            .join("")
        : '<div class="empty-state">本月没有账单变动。</div>';

      return `
        <section class="annual-month-group">
          <div class="annual-month-head">
            <h3>${month.label}</h3>
            <div class="annual-month-meta">
              <span class="status-pill">发生 ${formatCompactMoney(month.occurredTotal)}</span>
              <span class="status-pill ok">已还 ${formatCompactMoney(month.paidTotal)}</span>
              <span class="status-pill">${month.lines.length} 条</span>
            </div>
          </div>
          <div class="annual-month-lines">${lines}</div>
        </section>
      `;
    })
    .join("");
}

function renderFilters() {
  const configs = [
    {
      key: "direction",
      label: "方向",
      options: [
        ["all", "全部"],
        ["我欠别人", "我欠别人"],
        ["别人欠我", "别人欠我"],
      ],
    },
    {
      key: "status",
      label: "状态",
      options: [
        ["all", "全部"],
        ["进行中", "进行中"],
        ["已结清", "已结清"],
        ["已逾期", "已逾期"],
      ],
    },
    {
      key: "category",
      label: "分类",
      options: [["all", "全部"], ...Object.keys(categoryTree).map((item) => [item, item])],
    },
    {
      key: "due",
      label: "到期",
      options: [
        ["all", "全部"],
        ["7", "7 天内"],
        ["30", "30 天内"],
        ["overdue", "已逾期"],
      ],
    },
    { key: "counterparty", label: "对象搜索", type: "text", placeholder: "输入姓名或公司名" },
  ];

  els.filterBar.innerHTML = "";
  configs.forEach((config) => {
    const wrapper = document.createElement("div");
    wrapper.className = "filter-field";
    const label = document.createElement("label");
    label.textContent = config.label;
    let field;
    if (config.type === "text") {
      field = document.createElement("input");
      field.type = "text";
      field.placeholder = config.placeholder;
    } else {
      field = document.createElement("select");
      config.options.forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        field.appendChild(option);
      });
    }
    field.value = state.filters[config.key];
    field.addEventListener("input", () => {
      state.filters[config.key] = field.value;
      render();
    });
    filterRefs[config.key] = field;
    wrapper.append(label, field);
    els.filterBar.appendChild(wrapper);
  });
}

function renderForm() {
  els.debtForm.innerHTML = "";
  formFieldConfig.forEach((fieldConfig) => {
    const wrapper = document.createElement("div");
    wrapper.className = `field${fieldConfig.full ? " full" : ""}`;
    const label = document.createElement("label");
    label.htmlFor = `field-${fieldConfig.name}`;
    label.textContent = fieldConfig.label;
    let input;
    if (fieldConfig.type === "textarea") {
      input = document.createElement("textarea");
    } else if (fieldConfig.type === "select") {
      input = document.createElement("select");
      populateSelect(input, fieldConfig.options);
    } else {
      input = document.createElement("input");
      input.type = fieldConfig.type;
    }
    input.id = `field-${fieldConfig.name}`;
    input.name = fieldConfig.name;
    if (fieldConfig.placeholder) input.placeholder = fieldConfig.placeholder;
    if (fieldConfig.step) input.step = fieldConfig.step;
    if (fieldConfig.name === "category") {
      input.addEventListener("change", () => {
        refreshSubcategories(input.value);
      });
    }
    formRefs[fieldConfig.name] = input;
    wrapper.append(label, input);
    els.debtForm.appendChild(wrapper);
  });

  const actions = document.createElement("div");
  actions.className = "form-actions";
  actions.innerHTML = `
    <button type="submit" class="primary-button">保存记录</button>
    <button type="button" class="ghost-button" id="resetFormButton">清空表单</button>
    <button type="button" class="danger-button" id="deleteDebtButton">删除当前记录</button>
  `;
  els.debtForm.appendChild(actions);

  els.debtForm.addEventListener("submit", onSubmitForm);
  actions.querySelector("#resetFormButton").addEventListener("click", resetForm);
  actions.querySelector("#deleteDebtButton").addEventListener("click", onDeleteCurrentDebt);
  resetForm();
}

function renderDebtList() {
  const list = filteredDebts();
  if (!list.length) {
    els.debtList.innerHTML = `<div class="empty-state">当前没有匹配记录。可以手动录入，或导入凭证生成草稿。</div>`;
    return;
  }

  els.debtList.innerHTML = list
    .map((item) => {
      const remaining = debtRemaining(item);
      const selected = item.id === state.selectedDebtId ? "selected" : "";
      return `
        <article class="debt-card ${selected}" data-id="${item.id}">
          <div class="debt-card-header">
            <div>
              <div class="debt-card-title">${escapeHtml(item.counterparty || "未命名对象")}</div>
              <div class="muted">${escapeHtml(item.direction)} · ${escapeHtml(item.category)} / ${escapeHtml(item.subcategory)}</div>
            </div>
            <span class="status-pill ${statusTone(item.status)}">${escapeHtml(item.status)}</span>
          </div>
          <div class="meta-row">
            <span>本金 ${formatMoney(item.principal, item.currency)}</span>
            <span>剩余 ${formatMoney(remaining, item.currency)}</span>
          </div>
          <div class="meta-row">
            <span>发生 ${item.occurredAt || "未填"}</span>
            <span>到期 ${item.dueDate || "未填"}</span>
          </div>
          <div class="tag-row">
            ${(item.tags || []).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
            <span class="pill">${item.sourceType === "imported" ? "导入生成" : "手动录入"}</span>
          </div>
        </article>
      `;
    })
    .join("");

  els.debtList.querySelectorAll(".debt-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedDebtId = card.dataset.id;
      state.editingId = card.dataset.id;
      fillForm(DebtService.find(card.dataset.id));
      render();
    });
  });
}

function renderDetail() {
  const debt = state.selectedDebtId ? DebtService.find(state.selectedDebtId) : null;
  if (!debt) {
    els.detailBody.innerHTML = `<div class="empty-state">选择一条记录后，这里会显示附件、识别结果、还款计划和实际还款。</div>`;
    return;
  }

  const remaining = debtRemaining(debt);
  const imported = debt.importedMeta;

  els.detailBody.innerHTML = `
    <section class="detail-stats">
      <div class="detail-stat">
        <span class="muted">本金</span>
        <strong>${formatMoney(debt.principal, debt.currency)}</strong>
      </div>
      <div class="detail-stat">
        <span class="muted">剩余未结清</span>
        <strong>${formatMoney(remaining, debt.currency)}</strong>
      </div>
      <div class="detail-stat">
        <span class="muted">计划数量</span>
        <strong>${debt.plans.length}</strong>
      </div>
      <div class="detail-stat">
        <span class="muted">已记录还款</span>
        <strong>${debt.payments.length}</strong>
      </div>
    </section>

    <section class="detail-section">
      <h3>基本信息</h3>
      <div class="detail-stat-row"><span class="muted">对象</span><span>${escapeHtml(debt.counterparty)}</span></div>
      <div class="detail-stat-row"><span class="muted">方向</span><span>${escapeHtml(debt.direction)}</span></div>
      <div class="detail-stat-row"><span class="muted">分类</span><span>${escapeHtml(debt.category)} / ${escapeHtml(debt.subcategory)}</span></div>
      <div class="detail-stat-row"><span class="muted">标签</span><span>${escapeHtml((debt.tags || []).join("、") || "无")}</span></div>
      <div class="detail-stat-row"><span class="muted">备注</span><span>${escapeHtml(debt.notes || "无")}</span></div>
    </section>

    <section class="detail-section">
      <h3>附件原件</h3>
      ${
        debt.attachments.length
          ? debt.attachments
              .map(
                (item) => `
                <div class="attachment-card">
                  <div>${escapeHtml(item.name)}</div>
                  <div class="muted">${escapeHtml(item.type || "未知格式")}</div>
                </div>`,
              )
              .join("")
          : '<p class="muted">暂无附件。</p>'
      }
    </section>

    <section class="detail-section">
      <h3>识别结果</h3>
      ${
        imported
          ? `
            <div class="detail-stat-row"><span class="muted">导入来源</span><span>${escapeHtml(imported.sourceType)}</span></div>
            <div class="detail-stat-row"><span class="muted">识别置信度</span><span>${Math.round(imported.confidence * 100)}%</span></div>
            <p class="muted">${escapeHtml(imported.rawText || "无原始文本")}</p>
            ${(imported.previewWarnings || []).map((w) => `<div class="preview-warning muted">${escapeHtml(w)}</div>`).join("")}
          `
          : '<p class="muted">该记录来自手动录入，没有导入识别数据。</p>'
      }
    </section>

    <section class="detail-section">
      <h3>还款计划</h3>
      <div class="mini-form" id="planBuilder">
        <div>
          <label for="planTotal">计划总额</label>
          <input id="planTotal" type="number" min="0" step="0.01" value="${remaining || debt.principal}" />
        </div>
        <div>
          <label for="planStart">开始日期</label>
          <input id="planStart" type="date" value="${todayString()}" />
        </div>
        <div>
          <label for="planCount">期数</label>
          <input id="planCount" type="number" min="1" step="1" value="4" />
        </div>
        <div>
          <label for="planFrequency">频率</label>
          <select id="planFrequency">
            <option value="每周">每周</option>
            <option value="每两周">每两周</option>
            <option value="每月" selected>每月</option>
          </select>
        </div>
        <div>
          <label for="planRule">建议规则</label>
          <select id="planRule">
            <option value="均摊">均摊</option>
            <option value="前高后低">前高后低</option>
          </select>
        </div>
        <div>
          <label for="planMonthlyCap">目标月供 / 每期上限</label>
          <input id="planMonthlyCap" type="number" min="0" step="0.01" value="${Math.ceil((remaining || debt.principal) / 4)}" />
        </div>
        <div class="full form-actions">
          <button class="primary-button" type="button" id="createSuggestedPlanButton">智能生成计划</button>
          <button class="ghost-button" type="button" id="createManualPlanButton">创建手动计划</button>
        </div>
      </div>
      <div class="plan-table">
        ${
          debt.plans.length
            ? debt.plans
                .map((plan) =>
                  plan.installments
                    .map(
                      (item) => `
                      <div class="plan-row">
                        <div>
                          <strong>${escapeHtml(plan.mode === "suggested" ? "智能计划" : "手动计划")}</strong>
                          <div class="muted">${escapeHtml(plan.frequency)} · ${escapeHtml(plan.rule)} · ${item.date}</div>
                        </div>
                        <div>
                          <input type="number" min="0" step="0.01" value="${item.amount}" data-action="update-installment-amount" data-plan-id="${plan.id}" data-installment-id="${item.id}" />
                        </div>
                        <div>
                          <input type="date" value="${item.date}" data-action="update-installment-date" data-plan-id="${plan.id}" data-installment-id="${item.id}" />
                        </div>
                        <div>
                          <button class="ghost-button" data-action="toggle-paid" data-plan-id="${plan.id}" data-installment-id="${item.id}">
                            ${item.paid ? "撤销已还" : "标记已还"}
                          </button>
                        </div>
                      </div>
                    `,
                    )
                    .join(""),
                )
                .join("")
            : '<p class="muted">还没有计划，可以先按规则生成，再逐期微调。</p>'
        }
      </div>
    </section>

    <section class="detail-section">
      <h3>实际还款记录</h3>
      <div class="payment-table">
        ${
          debt.payments.length
            ? debt.payments
                .map(
                  (payment) => `
                    <div class="payment-row">
                      <span>${payment.date}</span>
                      <span>${formatMoney(payment.amount, debt.currency)}</span>
                      <span class="muted">${escapeHtml(payment.note || "无备注")}</span>
                    </div>
                  `,
                )
                .join("")
            : '<p class="muted">暂无实际还款记录。</p>'
        }
      </div>
    </section>
  `;

  bindDetailEvents(debt.id);
}

function renderImportPreview() {
  const draft = state.importDraft;
  if (!draft) {
    els.importPreview.innerHTML = `<div class="empty-state">导入后会在这里显示识别字段、原始摘要和低置信度提示。</div>`;
    return;
  }

  const fieldOrder = [
    "direction",
    "counterparty",
    "principal",
    "currency",
    "occurredAt",
    "dueDate",
    "category",
    "subcategory",
    "tags",
    "notes",
  ];

  els.importPreview.innerHTML = `
    <div class="detail-stat-row">
      <span class="muted">导入来源</span>
      <span>${escapeHtml(draft.sourceType)}</span>
    </div>
    <div class="detail-stat-row">
      <span class="muted">综合置信度</span>
      <span>${Math.round(draft.confidence * 100)}%</span>
    </div>
    <div class="preview-table">
      ${fieldOrder.map((key) => renderPreviewField(key, draft.extractedFields[key])).join("")}
    </div>
    <div class="preview-warning">
      ${(draft.previewWarnings || []).map((warning) => `<p class="muted">${escapeHtml(warning)}</p>`).join("")}
    </div>
    <div class="form-actions">
      <button type="button" class="primary-button" id="saveImportedDebtButton">确认入账</button>
      <button type="button" class="ghost-button" id="applyImportToFormButton">先填到手动表单</button>
    </div>
  `;

  draft.previewWarnings = draft.previewWarnings || [];

  els.importPreview.querySelectorAll("[data-preview-key]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.previewKey;
      const value = input.value;
      draft.extractedFields[key].value = key === "principal" ? Number(value || 0) : value;
    });
  });

  const saveButton = els.importPreview.querySelector("#saveImportedDebtButton");
  const applyButton = els.importPreview.querySelector("#applyImportToFormButton");
  saveButton.addEventListener("click", saveImportedDebt);
  applyButton.addEventListener("click", () => {
    fillFormFromImportDraft();
    setMode("manual");
  });
}

async function onParseFile() {
  const file = els.importFile.files?.[0];
  if (!file) {
    els.importStatus.textContent = "请先选择文件。";
    return;
  }
  els.importStatus.textContent = `正在解析 ${file.name} ...`;
  const parsed = await FileParserService.parse(file);
  const extracted = ExtractionService.extract(parsed);
  extracted.extractedFields.attachmentName.value = file.name;
  state.importDraft = extracted;
  els.importStatus.textContent = `识别完成：${file.name}`;
  renderImportPreview();
}

function onSubmitForm(event) {
  event.preventDefault();
  const payload = readForm();
  if (!payload.counterparty || !payload.principal) {
    alert("对象和本金不能为空。");
    return;
  }
  const saved = DebtService.upsert(payload);
  state.selectedDebtId = saved.id;
  state.editingId = saved.id;
  syncAnnualYear();
  resetForm();
  render();
}

function onDeleteCurrentDebt() {
  if (!state.editingId) return;
  DebtService.remove(state.editingId);
  state.selectedDebtId = null;
  state.editingId = null;
  syncAnnualYear();
  resetForm();
  render();
}

function saveImportedDebt() {
  const draft = state.importDraft;
  if (!draft) return;
  const payload = {
    id: crypto.randomUUID(),
    sourceType: "imported",
    direction: draft.extractedFields.direction.value || "我欠别人",
    counterparty: draft.extractedFields.counterparty.value || "待确认对象",
    principal: Number(draft.extractedFields.principal.value || 0),
    currency: draft.extractedFields.currency.value || "CNY",
    occurredAt: draft.extractedFields.occurredAt.value || todayString(),
    dueDate: draft.extractedFields.dueDate.value || "",
    status: draft.extractedFields.status.value || "进行中",
    category: draft.extractedFields.category.value || Object.keys(categoryTree)[0],
    subcategory: draft.extractedFields.subcategory.value || categoryTree[Object.keys(categoryTree)[0]][0],
    tags: normalizeTags(draft.extractedFields.tags.value),
    notes: draft.extractedFields.notes.value || "",
    attachmentName: draft.extractedFields.attachmentName.value,
    attachments: [{ name: draft.extractedFields.attachmentName.value, type: draft.sourceType }],
    importedMeta: {
      sourceType: draft.sourceType,
      rawText: draft.rawText,
      confidence: draft.confidence,
      previewWarnings: draft.previewWarnings,
    },
    plans: [],
    payments: [],
  };
  const saved = DebtService.upsert(payload);
  state.selectedDebtId = saved.id;
  state.importDraft = null;
  syncAnnualYear();
  els.importFile.value = "";
  els.importStatus.textContent = "导入完成，已生成记录。";
  render();
}

function bindDetailEvents(debtId) {
  document.querySelector("#createSuggestedPlanButton")?.addEventListener("click", () => {
    const payload = readPlanBuilder();
    RepaymentPlanService.generateSuggestedPlan(debtId, payload);
    render();
  });

  document.querySelector("#createManualPlanButton")?.addEventListener("click", () => {
    const payload = readPlanBuilder();
    RepaymentPlanService.createManualPlan(debtId, payload);
    render();
  });

  document.querySelectorAll("[data-action='toggle-paid']").forEach((button) => {
    button.addEventListener("click", () => {
      RepaymentPlanService.markInstallmentPaid(debtId, button.dataset.planId, button.dataset.installmentId);
      render();
    });
  });

  document.querySelectorAll("[data-action='update-installment-amount']").forEach((input) => {
    input.addEventListener("change", () => {
      RepaymentPlanService.updateInstallment(debtId, input.dataset.planId, input.dataset.installmentId, {
        amount: Number(input.value || 0),
      });
      render();
    });
  });

  document.querySelectorAll("[data-action='update-installment-date']").forEach((input) => {
    input.addEventListener("change", () => {
      RepaymentPlanService.updateInstallment(debtId, input.dataset.planId, input.dataset.installmentId, {
        date: input.value,
      });
      render();
    });
  });
}

function readPlanBuilder() {
  return {
    totalAmount: document.querySelector("#planTotal").value,
    startDate: document.querySelector("#planStart").value,
    installments: Number(document.querySelector("#planCount").value || 1),
    frequency: document.querySelector("#planFrequency").value,
    rule: document.querySelector("#planRule").value,
    targetAmount: Number(document.querySelector("#planMonthlyCap").value || 0),
  };
}

function renderPreviewField(key, field) {
  const labelMap = {
    direction: "借贷方向",
    counterparty: "对象名",
    principal: "金额",
    currency: "币种",
    occurredAt: "发生日期",
    dueDate: "还款日期",
    category: "一级分类",
    subcategory: "二级分类",
    tags: "标签",
    notes: "原始摘要",
  };
  const confidence = Math.round(field.confidence * 100);
  const isLow = field.confidence < 0.7;
  const value = Array.isArray(field.value) ? field.value.join(",") : field.value;
  const input = key === "category"
    ? `<select data-preview-key="${key}">${Object.keys(categoryTree)
        .map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${option}</option>`)
        .join("")}</select>`
    : key === "subcategory"
      ? `<select data-preview-key="${key}">${categoryTree[
          state.importDraft?.extractedFields.category.value || Object.keys(categoryTree)[0]
        ]
          .map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${option}</option>`)
          .join("")}</select>`
      : `<input data-preview-key="${key}" value="${escapeAttribute(value ?? "")}" />`;
  return `
    <div class="preview-row ${isLow ? "low-confidence" : ""}">
      <strong>${labelMap[key]}</strong>
      <span class="muted">${confidence}%</span>
      ${input}
    </div>
  `;
}

function setMode(mode) {
  state.activeMode = mode;
  els.segmentedButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  els.manualPanel.classList.toggle("hidden", mode !== "manual");
  els.importPanel.classList.toggle("hidden", mode !== "import");
}

function setView(view) {
  state.currentView = view;
  render();
}

function syncAnnualYear() {
  state.annualYear = availableYears()[0];
}

function availableYears() {
  const years = new Set([new Date().getFullYear()]);
  state.debts.forEach((debt) => {
    if (debt.occurredAt) years.add(Number(debt.occurredAt.slice(0, 4)));
    (debt.payments || []).forEach((payment) => {
      if (payment.date) years.add(Number(payment.date.slice(0, 4)));
    });
  });
  return [...years].sort((a, b) => b - a);
}

function populateYearSelect(years) {
  els.annualYearSelect.innerHTML = years
    .map((year) => `<option value="${year}" ${year === state.annualYear ? "selected" : ""}>${year}</option>`)
    .join("");
}

function buildAnnualLedger(year) {
  const months = Array.from({ length: 12 }, (_, index) => ({
    index,
    label: `${index + 1} 月`,
    occurredTotal: 0,
    paidTotal: 0,
    lines: [],
  }));

  let totalOccurred = 0;
  let totalPaid = 0;
  let totalReceivable = 0;
  let totalPayable = 0;

  state.debts.forEach((debt) => {
    const occurredDate = debt.occurredAt ? new Date(debt.occurredAt) : null;
    if (occurredDate && occurredDate.getFullYear() === year) {
      const month = months[occurredDate.getMonth()];
      const principal = Number(debt.principal || 0);
      month.occurredTotal += principal;
      totalOccurred += principal;
      if (debt.direction === "别人欠我") totalReceivable += principal;
      else totalPayable += principal;
      month.lines.push({
        kind: debt.direction === "别人欠我" ? "新增应收" : "新增应还",
        title: debt.counterparty || "未命名对象",
        sub: `${debt.category} / ${debt.subcategory} · ${debt.status}`,
        amount: principal,
        currency: debt.currency || "CNY",
        directionClass: debt.direction === "别人欠我" ? "income" : "outcome",
      });
    }

    (debt.payments || []).forEach((payment) => {
      const paymentDate = payment.date ? new Date(payment.date) : null;
      if (!paymentDate || paymentDate.getFullYear() !== year) return;
      const month = months[paymentDate.getMonth()];
      const amount = Number(payment.amount || 0);
      month.paidTotal += amount;
      totalPaid += amount;
      month.lines.push({
        kind: "实际还款",
        title: debt.counterparty || "未命名对象",
        sub: payment.note || debt.direction,
        amount,
        currency: debt.currency || "CNY",
        directionClass: "income",
      });
    });
  });

  months.forEach((month) => {
    month.lines.sort((a, b) => {
      const kindWeight = { 新增应收: 0, 新增应还: 1, 实际还款: 2 };
      return (kindWeight[a.kind] ?? 99) - (kindWeight[b.kind] ?? 99);
    });
  });

  return {
    year,
    totalOccurred,
    totalPaid,
    totalReceivable,
    totalPayable,
    months,
  };
}

function filteredDebts() {
  return state.debts.filter((item) => {
    if (state.filters.direction !== "all" && item.direction !== state.filters.direction) return false;
    if (state.filters.status !== "all" && item.status !== state.filters.status) return false;
    if (state.filters.category !== "all" && item.category !== state.filters.category) return false;
    if (
      state.filters.counterparty &&
      !item.counterparty.toLowerCase().includes(state.filters.counterparty.toLowerCase())
    ) {
      return false;
    }
    if (state.filters.due === "overdue" && !isOverdue(item.dueDate, item.status)) return false;
    if (state.filters.due === "7" && !isDueWithin(item.dueDate, 7)) return false;
    if (state.filters.due === "30" && !isDueWithin(item.dueDate, 30)) return false;
    return true;
  });
}

function readForm() {
  const existing = DebtService.find(state.editingId);
  return {
    id: state.editingId || crypto.randomUUID(),
    sourceType: existing?.sourceType || "manual",
    direction: formRefs.direction.value,
    counterparty: formRefs.counterparty.value.trim(),
    principal: Number(formRefs.principal.value || 0),
    currency: formRefs.currency.value,
    occurredAt: formRefs.occurredAt.value,
    dueDate: formRefs.dueDate.value,
    status: formRefs.status.value,
    category: formRefs.category.value,
    subcategory: formRefs.subcategory.value,
    tags: normalizeTags(formRefs.tags.value),
    notes: formRefs.notes.value.trim(),
    attachmentName: formRefs.attachmentName.value.trim(),
    attachments: formRefs.attachmentName.value.trim()
      ? [{ name: formRefs.attachmentName.value.trim(), type: "manual-note" }]
      : existing?.attachments || [],
    importedMeta: existing?.importedMeta || null,
    plans: existing?.plans || [],
    payments: existing?.payments || [],
  };
}

function fillForm(debt) {
  if (!debt) return;
  formRefs.direction.value = debt.direction;
  formRefs.counterparty.value = debt.counterparty;
  formRefs.principal.value = debt.principal;
  formRefs.currency.value = debt.currency;
  formRefs.occurredAt.value = debt.occurredAt;
  formRefs.dueDate.value = debt.dueDate;
  formRefs.status.value = debt.status;
  formRefs.category.value = debt.category;
  refreshSubcategories(debt.category, debt.subcategory);
  formRefs.tags.value = (debt.tags || []).join(",");
  formRefs.notes.value = debt.notes || "";
  formRefs.attachmentName.value = debt.attachmentName || "";
}

function fillFormFromImportDraft() {
  const draft = state.importDraft;
  if (!draft) return;
  formRefs.direction.value = draft.extractedFields.direction.value || "我欠别人";
  formRefs.counterparty.value = draft.extractedFields.counterparty.value || "";
  formRefs.principal.value = draft.extractedFields.principal.value || "";
  formRefs.currency.value = draft.extractedFields.currency.value || "CNY";
  formRefs.occurredAt.value = draft.extractedFields.occurredAt.value || todayString();
  formRefs.dueDate.value = draft.extractedFields.dueDate.value || "";
  formRefs.status.value = draft.extractedFields.status.value || "进行中";
  formRefs.category.value = draft.extractedFields.category.value || Object.keys(categoryTree)[0];
  refreshSubcategories(formRefs.category.value, draft.extractedFields.subcategory.value);
  formRefs.tags.value = normalizeTags(draft.extractedFields.tags.value).join(",");
  formRefs.notes.value = draft.extractedFields.notes.value || "";
  formRefs.attachmentName.value = draft.extractedFields.attachmentName.value || "";
}

function resetForm() {
  state.editingId = null;
  formRefs.direction.value = "我欠别人";
  formRefs.counterparty.value = "";
  formRefs.principal.value = "";
  formRefs.currency.value = "CNY";
  formRefs.occurredAt.value = todayString();
  formRefs.dueDate.value = "";
  formRefs.status.value = "进行中";
  formRefs.category.value = Object.keys(categoryTree)[0];
  refreshSubcategories(Object.keys(categoryTree)[0]);
  formRefs.tags.value = "";
  formRefs.notes.value = "";
  formRefs.attachmentName.value = "";
}

function refreshSubcategories(category, selected) {
  populateSelect(formRefs.subcategory, categoryTree[category] || []);
  formRefs.subcategory.value = selected || categoryTree[category]?.[0] || "";
}

function populateSelect(select, options) {
  select.innerHTML = "";
  options.forEach((optionText) => {
    const option = document.createElement("option");
    option.value = optionText;
    option.textContent = optionText;
    select.appendChild(option);
  });
}

function summarizeDebts(items) {
  return items.reduce(
    (acc, item) => {
      acc.count += 1;
      if (item.direction === "我欠别人") acc.borrowed += debtRemaining(item);
      if (item.direction === "别人欠我") acc.lent += debtRemaining(item);
      if (isDueWithin(item.dueDate, 30) || isOverdue(item.dueDate, item.status)) acc.dueSoon += 1;
      return acc;
    },
    { count: 0, borrowed: 0, lent: 0, dueSoon: 0 },
  );
}

function debtRemaining(debt) {
  const paid = (debt.payments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return Math.max(Number(debt.principal || 0) - paid, 0);
}

function normalizeDebt(input) {
  return {
    id: input.id || crypto.randomUUID(),
    sourceType: input.sourceType || "manual",
    direction: input.direction,
    counterparty: input.counterparty,
    principal: Number(input.principal || 0),
    currency: input.currency || "CNY",
    occurredAt: input.occurredAt || todayString(),
    dueDate: input.dueDate || "",
    status: input.status || "进行中",
    category: input.category || Object.keys(categoryTree)[0],
    subcategory: input.subcategory || categoryTree[Object.keys(categoryTree)[0]][0],
    tags: normalizeTags(input.tags),
    notes: input.notes || "",
    attachmentName: input.attachmentName || "",
    attachments: input.attachments || [],
    importedMeta: input.importedMeta || null,
    plans: input.plans || [],
    payments: input.payments || [],
  };
}

function buildInstallments(payload) {
  const baseAmount = Number(payload.totalAmount || 0) / Number(payload.installments || 1);
  return Array.from({ length: Number(payload.installments || 1) }, (_, index) =>
    installment(nextDate(payload.startDate, payload.frequency, index), roundMoney(baseAmount), false),
  );
}

function buildSuggestedInstallments(payload) {
  const count = Number(payload.installments || 1);
  const total = Number(payload.totalAmount || 0);
  const cap = Number(payload.targetAmount || 0);
  let amounts;
  if (payload.rule === "前高后低") {
    const weights = Array.from({ length: count }, (_, index) => count - index);
    const totalWeight = weights.reduce((sum, item) => sum + item, 0);
    amounts = weights.map((weight) => roundMoney((total * weight) / totalWeight));
  } else {
    const even = roundMoney(total / count);
    amounts = Array.from({ length: count }, () => even);
  }
  if (cap > 0) {
    amounts = amounts.map((amount) => Math.min(amount, cap));
    const diff = roundMoney(total - amounts.reduce((sum, amount) => sum + amount, 0));
    amounts[amounts.length - 1] = roundMoney(amounts[amounts.length - 1] + diff);
  } else {
    const diff = roundMoney(total - amounts.reduce((sum, amount) => sum + amount, 0));
    amounts[amounts.length - 1] = roundMoney(amounts[amounts.length - 1] + diff);
  }
  return amounts.map((amount, index) => installment(nextDate(payload.startDate, payload.frequency, index), amount, false));
}

function installment(date, amount, paid) {
  return {
    id: crypto.randomUUID(),
    date,
    amount: roundMoney(amount),
    paid,
  };
}

function inferSourceType(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || file.name.endsWith(".pdf")) return "pdf";
  if (file.name.endsWith(".csv")) return "csv";
  if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) return "excel";
  return "unknown";
}

function inferDirection(text) {
  if (/向我借|应收|待收|别人欠我|借给/.test(text)) return "别人欠我";
  if (/我借|应还|待还|我欠|借款人/.test(text)) return "我欠别人";
  return "我欠别人";
}

function inferCategory(text, direction) {
  if (/房租|水电|医药|学费|生活/.test(text)) return "生活往来";
  if (/客户|项目|贸易|货款|周转|经营/.test(text)) return "经营周转";
  if (/家庭|亲友|孩子|父母/.test(text)) return "家庭责任";
  if (/工资|报销|劳务|公司/.test(text)) return "职业收入";
  if (/信用卡|分期|投资|资产/.test(text)) return "资产安排";
  return direction === "别人欠我" ? "经营周转" : "生活往来";
}

function suggestTags(text, direction) {
  const tags = [];
  if (/截图|聊天|微信|支付宝/.test(text)) tags.push("截图凭证");
  if (/合同|借条/.test(text)) tags.push("书面约定");
  if (/客户|公司|项目/.test(text)) tags.push("经营");
  if (/房租|生活|餐饮/.test(text)) tags.push("生活");
  if (direction === "别人欠我") tags.push("应收");
  else tags.push("应还");
  return [...new Set(tags)];
}

function summarizeText(text, max = 120) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function averageConfidence(fields) {
  const values = Object.values(fields).map((item) => item.confidence || 0);
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function cleanupCounterparty(value) {
  return value.replace(/^(向|与|收自|付款给)/, "").trim();
}

function normalizeDateMatch(match) {
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

function normalizeDateText(text) {
  if (/^\d{1,2}月\d{1,2}日$/.test(text)) {
    const year = new Date().getFullYear();
    const [month, day] = text.replace("日", "").split("月");
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const match = text.match(/(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/);
  return match ? normalizeDateMatch(match) : "";
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "")
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function nextDate(startDate, frequency, index) {
  const date = new Date(startDate || todayString());
  if (frequency === "每周") date.setDate(date.getDate() + index * 7);
  else if (frequency === "每两周") date.setDate(date.getDate() + index * 14);
  else date.setMonth(date.getMonth() + index);
  return date.toISOString().slice(0, 10);
}

function isDueWithin(dateString, days) {
  if (!dateString) return false;
  const today = new Date(todayString());
  const target = new Date(dateString);
  const diff = (target - today) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}

function isOverdue(dateString, status) {
  if (!dateString || status === "已结清") return false;
  return new Date(dateString) < new Date(todayString());
}

function statusTone(status) {
  if (status === "已结清") return "ok";
  if (status === "已逾期") return "alert";
  return "warn";
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.debts));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMoney(value, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatCompactMoney(value) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
