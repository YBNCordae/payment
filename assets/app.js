const STORAGE_KEY = "teaching-demo:v4";
const LOGIN_POLICY = {
  maxAttempts: 5,
  lockMinutes: 10,
};

const DEFAULT_COURSE_TYPES = [
  { id: "required", label: "必修课", coef: 1, price: 120, desc: "面向专业核心课程的标准教学工作量。" },
  { id: "elective", label: "选修课", coef: 0.9, price: 108, desc: "面向选修模块和拓展课程的教学工作量。" },
  { id: "public", label: "公共课", coef: 1.05, price: 112, desc: "面向跨学院共享课程和公共基础课程。" },
  { id: "lab", label: "实验课", coef: 1.2, price: 128, desc: "包含实验准备、机房值守和实验指导的教学工作量。" },
  { id: "practice", label: "实践课", coef: 1.25, price: 138, desc: "适用于实训、课程设计和项目制教学。" },
  { id: "thesis", label: "毕业设计", coef: 1.35, price: 150, desc: "适用于毕业设计、论文指导与答辩组织。" },
];

const SIZE_RULES = [
  { min: 0, max: 39, coef: 1, label: "1-39 人" },
  { min: 40, max: 79, coef: 1.1, label: "40-79 人" },
  { min: 80, max: 119, coef: 1.2, label: "80-119 人" },
  { min: 120, max: Number.POSITIVE_INFINITY, coef: 1.32, label: "120 人及以上" },
];

const DEPARTMENTS = ["计算机学院", "人工智能学院", "信息工程学院", "数学与统计学院", "经济管理学院", "公共基础教学部", "教务处"];

const STATUS_META = {
  pending: { label: "待审批", tone: "pending" },
  approved: { label: "已通过", tone: "approved" },
  returned: { label: "已退回", tone: "returned" },
};

const ACCOUNT_STATUS_META = {
  pending: { label: "待审核", tone: "pending" },
  approved: { label: "已通过", tone: "approved" },
  rejected: { label: "已拒绝", tone: "rejected" },
};

const STATUS_ORDER = {
  pending: 0,
  returned: 1,
  approved: 2,
};

const DEFAULT_FILTERS = {
  status: "all",
  semester: "all",
  keyword: "",
};

const SEMESTERS = buildSemesterOptions();

let store = loadStore();

const ui = {
  notice: null,
  noticeTimer: null,
  teacherEditId: null,
  adminFilters: { ...DEFAULT_FILTERS },
  selectedIds: new Set(),
  reviewId: null,
  reviewNote: "",
  authFeedback: {
    teacher: null,
    admin: null,
  },
  lastRoute: "",
  teacherDraftTouchedAt: "",
};

const app = document.getElementById("app");

boot();

function boot() {
  renderShell();
  window.addEventListener("hashchange", () => renderApp({ reason: "route" }));
  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);

  if (!window.location.hash) {
    navigate("/");
    return;
  }

  renderApp({ reason: "boot" });
}

function renderShell() {
  if (app.querySelector(".app-shell")) return;

  app.innerHTML = `
    <main class="app-shell">
      <div id="topbar-slot"></div>
      <div id="notice-slot"></div>
      <div id="page-slot"></div>
      <p class="footer-note" id="footer-slot"></p>
    </main>
  `;
}

function renderApp(options = {}) {
  renderShell();
  pruneSelectedIds();

  const route = getRoute();
  const previousRoute = ui.lastRoute;
  const preserveScroll = previousRoute === route && options.preserveScroll !== false;
  const previousScroll = preserveScroll ? window.scrollY : 0;

  let user = getCurrentUser();
  if (user?.role === "teacher" && !isTeacherApproved(user)) {
    clearSession();
    user = null;
  }

  const redirect = resolveRouteGuard(route, user);
  if (redirect) {
    navigate(redirect);
    return;
  }

  const activeUser = getCurrentUser();
  const routeChanged = previousRoute !== route || options.reason === "boot";

  document.body.dataset.view = resolveViewName(route);
  document.getElementById("topbar-slot").innerHTML = renderTopbar(activeUser);
  document.getElementById("page-slot").innerHTML = `
    <div class="page-stage ${routeChanged ? "page-enter" : ""}">
      ${renderRoute(route, activeUser)}
    </div>
  `;
  document.getElementById("footer-slot").textContent =
    "当前为演示环境，账号、申报、审批记录、课程模式与草稿均保存在浏览器本地。后续可平滑替换为统一认证、数据库和消息通知服务。";

  renderNotice();
  postRender(route, activeUser);
  ui.lastRoute = route;

  if (preserveScroll) {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: previousScroll });
    });
  }
}

function renderRoute(route, user) {
  if (route === "/") return renderHome();
  if (route === "/teacher-login") return renderLoginPage("teacher");
  if (route === "/admin-login") return renderLoginPage("admin");
  if (route === "/register/teacher") return renderRegisterPage("teacher");
  if (route === "/register/admin") return renderRegisterPage("admin");
  if (route === "/teacher") return renderTeacherDashboard(user);
  if (route === "/admin") return renderAdminDashboard(user);
  return renderNotFound();
}

function postRender(route, user) {
  if (route === "/teacher") {
    syncClaimPreview();
    syncDraftStatus(user);
  }

  if (route === "/teacher-login") {
    syncAuthFeedback("teacher");
  }

  if (route === "/admin-login") {
    syncAuthFeedback("admin");
  }

  if (route === "/admin") {
    syncAdminSelectionUI();
  }
}

function renderTopbar(user) {
  const dashboardLink = user ? (user.role === "teacher" ? "#/teacher" : "#/admin") : "#/";

  return `
    <header class="topbar">
      <a class="brand" href="#/">
        <span class="brand-mark">TH</span>
        <span class="brand-copy">
          <strong>校内课时申报与审批系统</strong>
          <span>教师申报、管理员审核、导出与提醒一体化演示</span>
        </span>
      </a>

      <div class="topbar-actions">
        ${
          user
            ? `
              <a class="nav-link desktop-only" href="${dashboardLink}">${user.role === "teacher" ? "教师工作台" : "管理员工作台"}</a>
              <span class="segmented-link desktop-only">${escapeHtml(user.name)} · ${escapeHtml(user.role === "teacher" ? "教师" : "管理员")}</span>
              <button class="button-secondary" type="button" data-action="logout">退出登录</button>
            `
            : `
              <a class="nav-link" href="#/teacher-login">教师登录</a>
              <a class="nav-link" href="#/admin-login">管理员登录</a>
            `
        }
      </div>
    </header>
  `;
}

function renderNotice() {
  const slot = document.getElementById("notice-slot");
  if (!slot) return;

  if (!ui.notice?.message) {
    slot.innerHTML = "";
    return;
  }

  slot.innerHTML = `
    <div class="notice ${escapeHtml(ui.notice.type || "info")}">
      <span>${escapeHtml(ui.notice.message)}</span>
      <button class="notice-close" type="button" data-action="dismiss-notice" aria-label="关闭提示">关闭</button>
    </div>
  `;
}

function renderHome() {
  const courseTypes = getCourseTypes();

  return `
    <section class="home-grid">
      <article class="hero-panel hero-panel-primary">
        <div class="hero-copy">
          <span class="eyebrow">教学工作量管理</span>
          <h1>把申报、审批、提醒和导出，整理成一套更像成熟产品的流程。</h1>
          <p>
            这套演示系统面向学校内部课时管理场景，支持教师与管理员双角色协作，
            覆盖注册审核、课时申报、审批退回、批量导出、邮件提醒、课程模式配置等关键环节。
          </p>
        </div>

        <div class="hero-stats">
          ${renderSummaryCard("角色入口", "2 个", "教师端和管理员端分开管理，职责边界更清晰")}
          ${renderSummaryCard("核心流程", "6 步", "注册、登录、申报、审批、提醒、导出完整闭环")}
          ${renderSummaryCard("数据保存", "本地存储", "无需后端即可演示完整业务流程")}
          ${renderSummaryCard("风控能力", "登录限流", "连续输错密码会自动锁定，降低误用风险")}
        </div>

        <div class="inline-actions spaced">
          <a class="button" href="#/teacher-login">进入教师端</a>
          <a class="button-secondary" href="#/admin-login">进入管理员端</a>
        </div>
      </article>

      <aside class="stack">
        <article class="role-card teacher-card">
          <span class="panel-kicker">教师端</span>
          <h3>教师提交流程更清楚</h3>
          <p class="muted">支持自动草稿保存、实时课时测算、退回后重提、最近反馈查看，减少重复录入和沟通成本。</p>
          <ul class="bullet-list">
            <li>申报单填写时实时预估折算课时和金额</li>
            <li>额外课时或调整系数变动时强制填写依据说明</li>
            <li>未提交内容会自动保存草稿，降低误操作损失</li>
          </ul>
          <div class="inline-actions">
            <a class="button" href="#/teacher-login">教师登录</a>
            <a class="button-ghost" href="#/register/teacher">教师注册</a>
          </div>
        </article>

        <article class="role-card admin-card">
          <span class="panel-kicker">管理员端</span>
          <h3>审批与配置集中处理</h3>
          <p class="muted">审批记录、教师开户审核、课程模式维护、批量导入与提醒都放在一个工作台，方便统一处理。</p>
          <ul class="bullet-list">
            <li>仅允许待审批记录进入审批动作，避免状态流转混乱</li>
            <li>支持批量通过、筛选导出和提醒待处理教师</li>
            <li>新增最近操作日志，便于演示时回看过程</li>
          </ul>
          <div class="inline-actions">
            <a class="button" href="#/admin-login">管理员登录</a>
            <a class="button-ghost" href="#/register/admin">管理员注册</a>
          </div>
        </article>
      </aside>
    </section>

    <section class="panel spaced">
      <div class="section-head">
        <div>
          <span class="panel-kicker">默认规则</span>
          <h2>当前演示采用的通用计费逻辑</h2>
          <p>便于先把流程走通，后续可以直接替换为学校正式口径和审批制度。</p>
        </div>
      </div>

      <div class="info-grid">
        <div class="story-card">
          <span class="panel-kicker">计算公式</span>
          <h3>折算课时</h3>
          <p class="muted">折算课时 = (周数 × 周学时 + 额外课时) × 课程系数 × 人数系数 × 调整系数</p>
          <p class="muted">课时费 = 折算课时 × 课时单价</p>
        </div>

        <div class="story-card">
          <span class="panel-kicker">课程模式</span>
          <ul class="bullet-list">
            ${courseTypes.map((item) => `<li>${escapeHtml(item.label)}：系数 ${formatPlain(item.coef)}，单价 ${formatCurrency(item.price)}</li>`).join("")}
          </ul>
        </div>

        <div class="story-card">
          <span class="panel-kicker">控制项</span>
          <ul class="bullet-list">
            <li>登录连续输错 5 次，锁定 10 分钟</li>
            <li>重复课程代码与教学班组合禁止重复申报</li>
            <li>退回记录必须由教师重新提交后才能再次审批</li>
          </ul>
        </div>

        <div class="story-card">
          <span class="panel-kicker">演示账号</span>
          <ul class="bullet-list">
            <li>教师：<code>zhang.teacher</code> / <code>Demo123!</code></li>
            <li>管理员：<code>admin</code> / <code>Demo123!</code></li>
            <li>教师注册后需管理员审核通过后才能登录</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="panel spaced">
      <div class="section-head">
        <div>
          <span class="panel-kicker">流程总览</span>
          <h2>从注册到导出的协作闭环</h2>
          <p>适合做产品演示，也适合在需求梳理阶段快速确认关键联动。</p>
        </div>
      </div>

      <div class="story-grid">
        ${renderStoryCard("1. 教师注册", "教师提交姓名、账号、邮箱、院系与工号；管理员审核通过后生效。")}
        ${renderStoryCard("2. 教师登录", "支持演示账号一键填充，密码错误会立即反馈，并显示剩余尝试次数。")}
        ${renderStoryCard("3. 课时申报", "教师填写课程信息时同步看到折算课时和金额预估，并自动保存草稿。")}
        ${renderStoryCard("4. 管理员审批", "管理员只处理待审批记录，支持单条审核和批量通过。")}
        ${renderStoryCard("5. 结果跟进", "退回记录可修改后重提，管理员可对待处理记录发起邮件提醒。")}
        ${renderStoryCard("6. 数据导出", "支持导出所选记录或当前筛选结果，便于汇总与留档。")}
      </div>
    </section>
  `;
}

function renderSummaryCard(label, value, note) {
  return `
    <article class="metric-card">
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(note)}</span>
    </article>
  `;
}

function renderStoryCard(title, description) {
  return `
    <article class="story-card">
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(description)}</p>
    </article>
  `;
}

function renderNotFound() {
  return `
    <section class="panel spaced">
      <div class="empty-state">
        <p>页面不存在，请返回首页或重新进入教师端、管理员端入口。</p>
      </div>
    </section>
  `;
}

function renderLoginPage(role) {
  const isTeacher = role === "teacher";
  const title = isTeacher ? "教师登录" : "管理员登录";
  const heading = isTeacher ? "教师在这里提交教学工作量申报。" : "管理员在这里集中处理审批与配置。";
  const description = isTeacher
    ? "登录后可填写课时申报、查看实时测算结果、跟踪审批状态，并恢复上次未提交的草稿。"
    : "登录后可筛选审批记录、审核教师账号、导入教师名单、维护课程模式并导出结果。";
  const usernamePlaceholder = isTeacher ? "例如：zhang.teacher" : "例如：admin";
  const demoUser = isTeacher ? "zhang.teacher" : "admin";

  return `
    <section class="auth-shell">
      <div class="auth-layout">
        <article class="auth-copy">
          <span class="eyebrow">${title}</span>
          <h1>${heading}</h1>
          <p>${description}</p>

          <div class="panel-grid">
            ${renderStoryCard("即时反馈", "登录失败会立即提示原因，密码错误会展示剩余可尝试次数。")}
            ${renderStoryCard("安全控制", `同一账号连续输错 ${LOGIN_POLICY.maxAttempts} 次后会锁定 ${LOGIN_POLICY.lockMinutes} 分钟。`)}
          </div>

          <div class="muted-card spaced">
            <strong>演示账号</strong>
            <p class="muted">用户名：<code>${demoUser}</code></p>
            <p class="muted">密码：<code>Demo123!</code></p>
          </div>
        </article>

        <article class="auth-card">
          <div class="panel-head">
            <div>
              <span class="panel-kicker">${title}</span>
              <h2>${isTeacher ? "进入教师工作台" : "进入管理员工作台"}</h2>
              <p class="panel-subtitle">密码错误、锁定状态和审核结果都会在这里明确提示。</p>
            </div>
          </div>

          <form id="${role}-login-form" class="stack">
            <label class="field-stack">
              <span class="field-label">用户名</span>
              <input name="username" placeholder="${usernamePlaceholder}" autocomplete="username" />
            </label>

            ${renderPasswordField({
              id: `${role}-login-password`,
              name: "password",
              label: "密码",
              placeholder: "请输入密码",
              autocomplete: "current-password",
            })}

            <div class="helper-row">
              <span>连续输错 ${LOGIN_POLICY.maxAttempts} 次将临时锁定</span>
              <span>锁定时长 ${LOGIN_POLICY.lockMinutes} 分钟</span>
            </div>

            <div class="auth-feedback" data-auth-feedback="${role}"></div>

            <div class="inline-actions">
              <button class="button" type="submit">${title}</button>
              <button class="button-secondary" type="button" data-action="fill-demo" data-role="${role}">填入演示账号</button>
            </div>
          </form>

          <div class="auth-links">
            <a class="ghost-button" href="${isTeacher ? "#/register/teacher" : "#/register/admin"}">创建账号</a>
            <a class="ghost-button" href="#/">返回首页</a>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderRegisterPage(role) {
  const isTeacher = role === "teacher";
  const title = isTeacher ? "教师注册" : "管理员注册";
  const heading = isTeacher ? "提交教师账号申请，审批通过后即可开始申报。" : "创建管理员账号后可立即进入审批工作台。";
  const description = isTeacher
    ? "教师账号需要管理员审核通过后才能登录。建议使用学校统一邮箱、规范工号与真实姓名，便于后续审批。"
    : "管理员自助注册仅用于当前演示环境。正式上线时建议改为后台创建或接入统一身份认证。";

  return `
    <section class="auth-shell">
      <div class="auth-layout">
        <article class="auth-copy">
          <span class="eyebrow">${title}</span>
          <h1>${heading}</h1>
          <p>${description}</p>

          <div class="panel-grid">
            ${renderStoryCard("信息完整", "需填写姓名、用户名、邮箱、院系/部门、工号、密码和确认密码。")}
            ${renderStoryCard("密码要求", "密码至少 8 位，建议同时包含字母和数字，减少弱密码带来的误操作。")}
          </div>
        </article>

        <article class="auth-card">
          <div class="panel-head">
            <div>
              <span class="panel-kicker">${title}</span>
              <h2>${isTeacher ? "提交教师注册申请" : "创建管理员账号"}</h2>
              <p class="panel-subtitle">${isTeacher ? "提交后等待管理员审核。" : "创建成功后自动登录。"}</p>
            </div>
          </div>

          <form id="register-form" class="stack" data-role="${role}">
            <div class="field-grid">
              <label class="field-stack">
                <span class="field-label">姓名</span>
                <input name="name" placeholder="${isTeacher ? "例如：张晨" : "例如：教务管理员"}" />
              </label>

              <label class="field-stack">
                <span class="field-label">用户名</span>
                <input name="username" placeholder="${isTeacher ? "例如：zhang.teacher" : "例如：admin.office"}" autocomplete="username" />
              </label>

              <label class="field-stack">
                <span class="field-label">邮箱</span>
                <input name="email" type="email" placeholder="name@example.edu.cn" autocomplete="email" />
              </label>

              <label class="field-stack">
                <span class="field-label">${isTeacher ? "所属院系" : "所属部门"}</span>
                <select name="department">
                  ${renderSelectOptions(DEPARTMENTS, isTeacher ? DEPARTMENTS[0] : "教务处")}
                </select>
              </label>

              <label class="field-stack">
                <span class="field-label">${isTeacher ? "教师工号" : "管理员编号"}</span>
                <input name="employeeNo" placeholder="${isTeacher ? "例如：T2026008" : "例如：A2026003"}" />
              </label>
            </div>

            ${renderPasswordField({
              id: `${role}-register-password`,
              name: "password",
              label: "密码",
              placeholder: "至少 8 位，建议包含字母和数字",
              autocomplete: "new-password",
            })}

            ${renderPasswordField({
              id: `${role}-register-password-confirm`,
              name: "passwordConfirm",
              label: "确认密码",
              placeholder: "请再次输入密码",
              autocomplete: "new-password",
            })}

            <div class="helper-row">
              <span>用户名建议使用英文、数字、点和下划线</span>
              <span>${isTeacher ? "教师账号需管理员审核" : "管理员账号创建后自动登录"}</span>
            </div>

            <div class="inline-actions">
              <button class="button" type="submit">${isTeacher ? "提交注册申请" : "创建管理员账号"}</button>
              <a class="button-secondary" href="${isTeacher ? "#/teacher-login" : "#/admin-login"}">返回登录</a>
            </div>
          </form>
        </article>
      </div>
    </section>
  `;
}

function renderTeacherDashboard(user) {
  const claims = getTeacherClaims(user.id);
  const stats = getTeacherStats(claims);
  const editing = ui.teacherEditId ? claims.find((item) => item.id === ui.teacherEditId) : null;
  const defaults = getClaimDefaults(editing, user.id);
  const courseTypes = getCourseTypes();

  return `
    <section class="dashboard-intro">
      <div>
        <span class="eyebrow">教师工作台</span>
        <h1>${escapeHtml(user.name)}，在这里整理你的课时申报。</h1>
        <p class="muted">申报单填写时会同步预估折算课时和金额，未提交内容自动保存为草稿；退回记录修改后重新提交即可。</p>
      </div>

      <div class="chip-row">
        <span class="pill">${escapeHtml(user.department)}</span>
        <span class="pill">${escapeHtml(user.employeeNo)}</span>
        <span class="pill">${escapeHtml(guessCurrentSemester())}</span>
      </div>
    </section>

    <section class="summary-grid">
      ${renderSummaryCard("待审批记录", `${stats.pendingCount} 条`, "已提交但仍待管理员处理")}
      ${renderSummaryCard("已通过课时", `${formatNumber(stats.approvedHours)} 课时`, "仅统计审批通过的折算课时")}
      ${renderSummaryCard("已通过金额", formatCurrency(stats.approvedAmount), "仅统计审批通过的课时费")}
      ${renderSummaryCard("已退回记录", `${stats.returnedCount} 条`, "退回后可继续修改并重新提交")}
    </section>

    <section class="dashboard-grid">
      <article class="panel">
        <div class="panel-head">
          <div>
            <span class="panel-kicker">${editing ? "编辑申报" : "新建申报"}</span>
            <h2>${editing ? "修改并重新提交课时申报" : "填写新的课时申报"}</h2>
            <p class="panel-subtitle">课程代码与教学班组合不允许重复提交，额外课时和调整系数需写明依据。</p>
          </div>
        </div>

        <form id="teacher-claim-form" class="stack">
          <div class="field-grid">
            <label class="field-stack">
              <span class="field-label">学期</span>
              <select name="semester">${renderSelectOptions(SEMESTERS, defaults.semester)}</select>
            </label>

            <label class="field-stack">
              <span class="field-label">课程类型</span>
              <select name="courseType">${renderCourseTypeOptions(defaults.courseType)}</select>
            </label>

            <label class="field-stack">
              <span class="field-label">课程名称</span>
              <input name="courseName" value="${escapeHtml(defaults.courseName)}" placeholder="例如：数据结构" />
            </label>

            <label class="field-stack">
              <span class="field-label">课程代码</span>
              <input name="courseCode" value="${escapeHtml(defaults.courseCode)}" placeholder="例如：CS201" />
            </label>

            <label class="field-stack">
              <span class="field-label">教学班名称</span>
              <input name="className" value="${escapeHtml(defaults.className)}" placeholder="例如：2024级软件工程1班" />
            </label>

            <label class="field-stack">
              <span class="field-label">学生人数</span>
              <input name="studentCount" type="number" min="1" value="${escapeHtml(String(defaults.studentCount))}" />
            </label>

            <label class="field-stack">
              <span class="field-label">授课周数</span>
              <input name="weeks" type="number" min="1" max="30" value="${escapeHtml(String(defaults.weeks))}" />
            </label>

            <label class="field-stack">
              <span class="field-label">周学时</span>
              <input name="weeklyHours" type="number" min="0.5" max="12" step="0.5" value="${escapeHtml(String(defaults.weeklyHours))}" />
            </label>

            <label class="field-stack">
              <span class="field-label">额外课时</span>
              <input name="extraHours" type="number" min="0" max="120" step="0.5" value="${escapeHtml(String(defaults.extraHours))}" />
            </label>

            <label class="field-stack">
              <span class="field-label">调整系数</span>
              <input name="adjustmentCoef" type="number" min="0.5" max="2" step="0.05" value="${escapeHtml(String(defaults.adjustmentCoef))}" />
            </label>
          </div>

          <label class="field-stack">
            <span class="field-label">备注说明</span>
            <textarea name="remarks" placeholder="如填写了额外课时或调整系数，请说明依据、授课形式、分组方式或特殊工作量。">${escapeHtml(defaults.remarks)}</textarea>
          </label>

          <div class="helper-row">
            <span data-draft-status>填写中的内容会自动保存为草稿。</span>
            <span>提交后将进入待审批状态</span>
          </div>

          <div class="inline-actions">
            <button class="button" type="submit">${editing ? "更新并重新提交" : "提交申报"}</button>
            <button class="button-secondary" type="button" data-action="reset-claim">重置表单</button>
            ${editing ? `<button class="button-ghost" type="button" data-action="cancel-edit">取消编辑</button>` : ""}
          </div>
        </form>
      </article>

      <aside class="stack">
        <div id="claim-preview">${renderClaimPreview(defaults)}</div>

        <article class="panel">
          <div class="panel-head">
            <div>
              <span class="panel-kicker">课程模式</span>
              <h2>当前计费配置</h2>
            </div>
          </div>

          <div class="legend-list">
            ${courseTypes
              .map(
                (item) => `
                  <div class="legend-row">
                    <div>
                      <strong>${escapeHtml(item.label)}</strong>
                      <div class="table-note">${escapeHtml(item.desc)}</div>
                    </div>
                    <div class="text-right">
                      <strong>${formatPlain(item.coef)}</strong>
                      <div class="table-note">${formatCurrency(item.price)}</div>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      </aside>
    </section>

    <section class="panel spaced">
      <div class="panel-head">
        <div>
          <span class="panel-kicker">我的记录</span>
          <h2>课时申报记录</h2>
          <p class="panel-subtitle">你可以查看最近反馈、审批状态、修改次数和最近提交时间。</p>
        </div>
      </div>
      ${renderTeacherTable(claims)}
    </section>
  `;
}

function renderAdminDashboard(user) {
  const allClaims = sortClaims(getClaims());
  const claims = filterClaims(allClaims);
  const stats = getAdminStats(allClaims);
  const reviewItem = getReviewItem(allClaims, claims);
  const teacherApprovals = getTeacherApprovalList();
  const pendingTeacherCount = teacherApprovals.filter((item) => item.approvalStatus === "pending").length;
  const selectedCount = claims.filter((item) => ui.selectedIds.has(item.id)).length;
  const allVisibleSelected = claims.length > 0 && claims.every((item) => ui.selectedIds.has(item.id));

  return `
    <section class="dashboard-intro">
      <div>
        <span class="eyebrow">管理员工作台</span>
        <h1>${escapeHtml(user.name)}，在这里统一处理审批、账号和配置。</h1>
        <p class="muted">页面已经收口为单一工作台，审批动作只针对待审批记录开放，避免错误状态流转；最近操作日志会保留关键动作轨迹。</p>
      </div>

      <div class="chip-row">
        <span class="pill">${escapeHtml(user.department)}</span>
        <span class="pill">当前可见 ${claims.length} 条</span>
        <span class="pill" data-selected-summary>${selectedCount ? `已选中 ${selectedCount} 条` : "未选择任何记录"}</span>
        <span class="pill">待审核教师 ${pendingTeacherCount} 人</span>
      </div>
    </section>

    <section class="summary-grid">
      ${renderSummaryCard("待审批记录", `${stats.pendingCount} 条`, "仍需管理员处理的申报")}
      ${renderSummaryCard("已通过课时", `${formatNumber(stats.approvedHours)} 课时`, "审批通过记录的折算课时总和")}
      ${renderSummaryCard("已通过金额", formatCurrency(stats.approvedAmount), "审批通过记录的课时费总和")}
      ${renderSummaryCard("涉及教师数", `${stats.teacherCount} 人`, "当前所有申报记录覆盖的教师数量")}
    </section>

    <section class="panel spaced">
      <div class="panel-head">
        <div>
          <span class="panel-kicker">申报列表</span>
          <h2>审批与筛选</h2>
          <p class="panel-subtitle">支持按状态、学期、关键词筛选，支持勾选后批量通过、导出或提醒。</p>
        </div>

        <div class="inline-actions">
          <button class="button-secondary" type="button" data-action="export-filtered" ${claims.length ? "" : "disabled"}>导出筛选结果</button>
          <button class="button" type="button" data-action="approve-selected" data-requires-selection ${selectedCount ? "" : "disabled"}>批量通过所选</button>
        </div>
      </div>

      <form id="admin-filter-form" class="stack">
        <div class="filter-grid">
          <label>
            <span class="field-label">状态</span>
            <select name="status">${renderStatusOptions(ui.adminFilters.status)}</select>
          </label>

          <label>
            <span class="field-label">学期</span>
            <select name="semester">${renderSelectOptions(["all", ...SEMESTERS], ui.adminFilters.semester, { all: "全部学期" })}</select>
          </label>

          <label>
            <span class="field-label">关键词</span>
            <input name="keyword" value="${escapeHtml(ui.adminFilters.keyword)}" placeholder="教师、课程、教学班、工号" />
          </label>

          <label>
            <span class="field-label">已选记录</span>
            <select disabled>
              <option data-selected-summary-option>${selectedCount ? `已选中 ${selectedCount} 条` : "未选择任何记录"}</option>
            </select>
          </label>
        </div>

        <div class="filter-actions">
          <button class="button-secondary" type="submit">应用筛选</button>
          <button class="button-ghost" type="button" data-action="clear-filters">清空筛选</button>
          <button class="button-secondary" type="button" data-action="export-selected" data-requires-selection ${selectedCount ? "" : "disabled"}>导出所选记录</button>
          <button class="button-secondary" type="button" data-action="send-reminder-selected" data-requires-selection ${selectedCount ? "" : "disabled"}>提醒所选教师</button>
          <button class="button-danger" type="button" data-action="reset-demo">重置演示数据</button>
        </div>
      </form>

      <div class="spaced">
        ${renderAdminTable(claims, allVisibleSelected)}
      </div>
    </section>

    <section class="review-grid spaced">
      <article class="panel">
        <div class="panel-head">
          <div>
            <span class="panel-kicker">单条审批</span>
            <h2>审批详情</h2>
            <p class="panel-subtitle">退回记录需由教师重新提交后才能再次审批，已通过记录也不会再进入审批按钮范围。</p>
          </div>
        </div>
        ${renderReviewPanel(reviewItem)}
      </article>

      <article class="panel">
        ${renderActivityPanel()}
      </article>
    </section>

    <section class="admin-tools-grid spaced">
      <article class="panel">${renderTeacherApprovalPanel(teacherApprovals)}</article>
      <article class="panel">${renderTeacherImportPanel()}</article>
    </section>

    <section class="panel spaced">
      ${renderCourseTypeManager(getCourseTypes())}
    </section>
  `;
}

function renderTeacherTable(claims) {
  if (!claims.length) {
    return `<div class="empty-state"><p>当前还没有申报记录。你提交后的记录会立即显示在这里。</p></div>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>课程信息</th>
            <th>学期</th>
            <th>折算课时</th>
            <th>课时费</th>
            <th>状态</th>
            <th>最近反馈</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${claims
            .map(
              (item) => `
                <tr>
                  <td data-label="课程信息">
                    <div class="table-title">
                      <strong>${escapeHtml(item.courseName)}</strong>
                      <span>${escapeHtml(item.className)} · ${escapeHtml(item.courseCode || "-")}</span>
                      <span>最近提交：${escapeHtml(formatDateTime(item.submittedAt))}</span>
                    </div>
                  </td>
                  <td data-label="学期">
                    <div class="table-title">
                      <strong>${escapeHtml(item.semester)}</strong>
                      <span>${escapeHtml(courseLabel(item.courseType))}</span>
                      <span>修改次数：${item.revisionCount || 0}</span>
                    </div>
                  </td>
                  <td data-label="折算课时">
                    <div class="table-title">
                      <strong>${formatNumber(item.settledHours)} 课时</strong>
                      <span>基础 ${formatNumber(item.baseHours)} · 人数系数 ${formatPlain(item.sizeCoef)}</span>
                    </div>
                  </td>
                  <td data-label="课时费">${formatCurrency(item.amount)}</td>
                  <td data-label="状态">${renderStatusBadge(item.status)}</td>
                  <td data-label="最近反馈"><span class="table-note">${escapeHtml(item.approvalNote || "暂无反馈")}</span></td>
                  <td data-label="操作">
                    <div class="inline-actions">
                      ${canEditClaim(item) ? `<button class="mini-button" type="button" data-action="edit-claim" data-id="${item.id}">编辑</button>` : `<button class="mini-button" type="button" disabled>已锁定</button>`}
                    </div>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminTable(claims, allVisibleSelected) {
  if (!claims.length) {
    return `<div class="empty-state"><p>当前筛选条件下没有匹配记录。</p></div>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="checkbox-cell"><input type="checkbox" data-role="select-all" ${allVisibleSelected ? "checked" : ""} /></th>
            <th>教师</th>
            <th>课程</th>
            <th>课时</th>
            <th>金额</th>
            <th>状态</th>
            <th>提交时间</th>
            <th>提醒</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${claims
            .map(
              (item) => `
                <tr>
                  <td data-label="选择" class="checkbox-cell">
                    <input type="checkbox" data-role="select-one" data-id="${item.id}" ${ui.selectedIds.has(item.id) ? "checked" : ""} />
                  </td>
                  <td data-label="教师">
                    <div class="table-title">
                      <strong>${escapeHtml(item.teacherName)}</strong>
                      <span>${escapeHtml(item.department)} · ${escapeHtml(item.employeeNo)}</span>
                    </div>
                  </td>
                  <td data-label="课程">
                    <div class="table-title">
                      <strong>${escapeHtml(item.courseName)}</strong>
                      <span>${escapeHtml(item.semester)} · ${escapeHtml(item.className)}</span>
                    </div>
                  </td>
                  <td data-label="课时">
                    <div class="table-title">
                      <strong>${formatNumber(item.settledHours)} 课时</strong>
                      <span>基础 ${formatNumber(item.baseHours)} · 调整系数 ${formatPlain(item.adjustmentCoef)}</span>
                    </div>
                  </td>
                  <td data-label="金额">${formatCurrency(item.amount)}</td>
                  <td data-label="状态">${renderStatusBadge(item.status)}</td>
                  <td data-label="提交时间">${escapeHtml(formatDateTime(item.submittedAt))}</td>
                  <td data-label="提醒"><span class="table-note">${item.reminderCount ? `${item.reminderCount} 次` : "未提醒"}</span></td>
                  <td data-label="操作">
                    <div class="inline-actions">
                      <button class="mini-button" type="button" data-action="open-review" data-id="${item.id}">查看</button>
                      <button class="mini-button" type="button" data-action="quick-approve" data-id="${item.id}" ${item.status === "pending" ? "" : "disabled"}>通过</button>
                      <button class="mini-button" type="button" data-action="quick-return" data-id="${item.id}" ${item.status === "pending" ? "" : "disabled"}>退回</button>
                    </div>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderReviewPanel(item) {
  if (!item) {
    return `<div class="empty-state"><p>请先在上方列表中选择一条记录，再查看详细信息并执行审批。</p></div>`;
  }

  const canReview = item.status === "pending";
  const previousFeedback = item.approvalNote
    ? `
      <div class="muted-card spaced">
        <strong>最近反馈</strong>
        <p class="muted">${escapeHtml(item.approvalNote)}</p>
      </div>
    `
    : "";

  const lockMessage = canReview
    ? ""
    : `
      <div class="inline-feedback info">
        当前记录状态为“${escapeHtml(statusLabel(item.status))}”。只有待审批记录才能继续处理；
        如果这是退回记录，请等待教师修改后重新提交。
      </div>
    `;

  return `
    <div class="stack">
      <div class="detail-box">
        <div class="meta-list">
          <div class="meta-row"><span>教师</span><strong>${escapeHtml(item.teacherName)} / ${escapeHtml(item.employeeNo)}</strong></div>
          <div class="meta-row"><span>院系</span><strong>${escapeHtml(item.department)}</strong></div>
          <div class="meta-row"><span>课程</span><strong>${escapeHtml(item.courseName)} (${escapeHtml(item.courseCode || "-")})</strong></div>
          <div class="meta-row"><span>教学班</span><strong>${escapeHtml(item.className)}</strong></div>
          <div class="meta-row"><span>学期</span><strong>${escapeHtml(item.semester)}</strong></div>
          <div class="meta-row"><span>折算课时</span><strong>${formatNumber(item.settledHours)} 课时</strong></div>
          <div class="meta-row"><span>课时费</span><strong>${formatCurrency(item.amount)}</strong></div>
          <div class="meta-row"><span>修改次数</span><strong>${item.revisionCount || 0}</strong></div>
          <div class="meta-row"><span>提醒记录</span><strong>${escapeHtml(item.lastReminderAt ? `${formatDateTime(item.lastReminderAt)}（${item.reminderCount || 0} 次）` : "暂无")}</strong></div>
        </div>

        <div class="chip-row spaced">
          <span class="formula-chip">课程系数 ${formatPlain(item.typeCoef)}</span>
          <span class="formula-chip">人数系数 ${formatPlain(item.sizeCoef)}</span>
          <span class="formula-chip">调整系数 ${formatPlain(item.adjustmentCoef)}</span>
          <span class="formula-chip">${escapeHtml(statusLabel(item.status))}</span>
        </div>

        <div class="aside-note spaced">
          <strong>教师备注</strong>
          <p class="muted">${escapeHtml(item.remarks || "教师未填写备注。")}</p>
        </div>

        ${previousFeedback}
      </div>

      ${lockMessage}

      <form id="review-form" class="stack" data-id="${item.id}">
        <label class="field-stack">
          <span class="field-label">审批意见</span>
          <textarea name="reviewNote" placeholder="例如：核对教学任务无误，同意按当前规则审批。">${escapeHtml(ui.reviewNote)}</textarea>
        </label>

        <div class="helper-row">
          <span>最近审批时间：${escapeHtml(item.reviewedAt ? formatDateTime(item.reviewedAt) : "暂无")}</span>
          <span>审批人：${escapeHtml(item.reviewerName || "暂无")}</span>
        </div>

        <div class="inline-actions">
          <button class="button" type="submit" name="decision" value="approved" ${canReview ? "" : "disabled"}>审批通过</button>
          <button class="button-secondary" type="submit" name="decision" value="returned" ${canReview ? "" : "disabled"}>退回修改</button>
        </div>
      </form>
    </div>
  `;
}

function renderActivityPanel() {
  const items = Array.isArray(store.activity) ? store.activity.slice(0, 8) : [];

  return `
    <div class="panel-head">
      <div>
        <span class="panel-kicker">最近操作</span>
        <h2>活动日志</h2>
        <p class="panel-subtitle">用于回看审批、导入、提醒和配置修改等关键动作。</p>
      </div>
    </div>

    ${
      items.length
        ? `
          <div class="activity-list">
            ${items
              .map(
                (item) => `
                  <article class="activity-item">
                    <div class="activity-head">
                      <span class="status-badge ${escapeHtml(item.actorRole || "info")}">${escapeHtml(actorRoleLabel(item.actorRole))}</span>
                      <span class="activity-time">${escapeHtml(formatDateTime(item.createdAt))}</span>
                    </div>
                    <strong>${escapeHtml(item.actorName || "系统")}</strong>
                    <p>${escapeHtml(item.message || "")}</p>
                  </article>
                `
              )
              .join("")}
          </div>
        `
        : `<div class="empty-state"><p>最近还没有新的操作记录。</p></div>`
    }
  `;
}

function renderTeacherApprovalPanel(teachers) {
  const pendingCount = teachers.filter((item) => item.approvalStatus === "pending").length;
  const rejectedCount = teachers.filter((item) => item.approvalStatus === "rejected").length;
  const approvedCount = teachers.filter((item) => item.approvalStatus === "approved").length;

  return `
    <div class="panel-head">
      <div>
        <span class="panel-kicker">教师开户审核</span>
        <h2>教师账号审批</h2>
        <p class="panel-subtitle">教师注册后需管理员审核通过后才能登录教师端，避免未授权账号直接进入业务页面。</p>
      </div>
    </div>

    <div class="chip-row">
      <span class="count-pill">待审核 ${pendingCount} 人</span>
      <span class="count-pill">已通过 ${approvedCount} 人</span>
      <span class="count-pill">已拒绝 ${rejectedCount} 人</span>
    </div>

    <div class="spaced">${renderTeacherApprovalTable(teachers)}</div>
  `;
}

function renderTeacherApprovalTable(teachers) {
  if (!teachers.length) {
    return `<div class="empty-state"><p>当前没有教师注册申请记录。</p></div>`;
  }

  return `
    <div class="table-wrap compact-table">
      <table>
        <thead>
          <tr>
            <th>教师信息</th>
            <th>邮箱</th>
            <th>院系</th>
            <th>工号</th>
            <th>状态</th>
            <th>申请时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${teachers
            .map(
              (item) => `
                <tr>
                  <td data-label="教师信息">
                    <div class="table-title">
                      <strong>${escapeHtml(item.name)}</strong>
                      <span>${escapeHtml(item.username)}</span>
                    </div>
                  </td>
                  <td data-label="邮箱">${escapeHtml(item.email || "-")}</td>
                  <td data-label="院系">${escapeHtml(item.department || "-")}</td>
                  <td data-label="工号">${escapeHtml(item.employeeNo || "-")}</td>
                  <td data-label="状态">${renderAccountStatusBadge(item.approvalStatus)}</td>
                  <td data-label="申请时间">${escapeHtml(formatDateTime(item.createdAt))}</td>
                  <td data-label="操作">
                    <div class="inline-actions">
                      <button class="mini-button" type="button" data-action="approve-teacher-account" data-id="${item.id}" ${item.approvalStatus === "approved" ? "disabled" : ""}>通过</button>
                      <button class="mini-button" type="button" data-action="reject-teacher-account" data-id="${item.id}" ${item.approvalStatus === "rejected" ? "disabled" : ""}>拒绝</button>
                    </div>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTeacherImportPanel() {
  return `
    <div class="panel-head">
      <div>
        <span class="panel-kicker">批量导入</span>
        <h2>批量生成教师账号</h2>
        <p class="panel-subtitle">上传 CSV 后一次性创建多个教师账号，导入的账号默认自动通过审核。</p>
      </div>
    </div>

    <form id="teacher-import-form" class="stack">
      <label class="field-stack">
        <span class="field-label">导入文件（CSV）</span>
        <input name="teacherCsvFile" type="file" accept=".csv,text/csv" />
      </label>

      <div class="field-grid">
        <label class="field-stack">
          <span class="field-label">默认密码</span>
          <input name="defaultPassword" value="Demo123!" />
        </label>

        <label class="field-stack">
          <span class="field-label">默认院系</span>
          <select name="defaultDepartment">${renderSelectOptions(DEPARTMENTS, DEPARTMENTS[0])}</select>
        </label>
      </div>

      <div class="muted-card">
        <strong>CSV 表头示例</strong>
        <p class="muted">姓名,用户名,邮箱,所属院系,工号,密码</p>
        <p class="muted">至少需要：姓名、用户名、邮箱。默认密码需满足 8 位以上要求。</p>
      </div>

      <div class="inline-actions">
        <button class="button" type="submit">导入并生成账号</button>
        <button class="button-secondary" type="button" data-action="download-import-template">下载导入模板</button>
      </div>
    </form>
  `;
}

function renderCourseTypeManager(courseTypes) {
  const usedCourseTypeIds = new Set(getClaims().map((item) => item.courseType));

  return `
    <div class="panel-head">
      <div>
        <span class="panel-kicker">课程模式配置</span>
        <h2>课程模式与系数管理</h2>
        <p class="panel-subtitle">新增或调整课程模式后，教师端的测算规则会立即同步生效。</p>
      </div>
    </div>

    <div class="table-wrap compact-table">
      <table>
        <thead>
          <tr>
            <th>课程模式</th>
            <th>系数</th>
            <th>课时单价</th>
            <th>说明</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${courseTypes
            .map((item) => {
              const used = usedCourseTypeIds.has(item.id);
              const canDelete = courseTypes.length > 1 && !used;
              return `
                <tr>
                  <td data-label="课程模式"><strong>${escapeHtml(item.label)}</strong></td>
                  <td data-label="系数">${formatPlain(item.coef)}</td>
                  <td data-label="课时单价">${formatCurrency(item.price)}</td>
                  <td data-label="说明"><span class="table-note">${escapeHtml(item.desc || "暂无说明")}</span></td>
                  <td data-label="状态">${used ? "已被申报记录使用" : "可删除"}</td>
                  <td data-label="操作">
                    <button class="mini-button" type="button" data-action="delete-course-type" data-id="${item.id}" ${canDelete ? "" : "disabled"}>删除</button>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>

    <form id="course-type-form" class="stack spaced">
      <div class="field-grid">
        <label class="field-stack">
          <span class="field-label">课程模式名称</span>
          <input name="label" placeholder="例如：双语课" />
        </label>

        <label class="field-stack">
          <span class="field-label">课程系数</span>
          <input name="coef" type="number" min="0.1" max="5" step="0.01" value="1.00" />
        </label>

        <label class="field-stack">
          <span class="field-label">课时单价</span>
          <input name="price" type="number" min="1" step="1" value="120" />
        </label>

        <label class="field-stack">
          <span class="field-label">模式说明</span>
          <input name="desc" placeholder="例如：适用于双语授课课程" />
        </label>
      </div>

      <div class="inline-actions">
        <button class="button" type="submit">新增课程模式</button>
      </div>
    </form>
  `;
}

function renderClaimPreview(values) {
  const calc = calculateClaim(values);
  const courseType = findCourseType(calc.courseType);
  const needsReason = calc.extraHours > 0 || calc.adjustmentCoef !== 1;

  return `
    <article class="panel">
      <div class="panel-head">
        <div>
          <span class="panel-kicker">实时测算</span>
          <h2>课时与金额预估</h2>
          <p class="panel-subtitle">表单任一字段变化后，这里的结果会立刻更新。</p>
        </div>
      </div>

      <div class="formula-box">
        <div class="chip-row">
          <span class="formula-chip">${escapeHtml(courseType.label)}</span>
          <span class="formula-chip">课程系数 ${formatPlain(calc.typeCoef)}</span>
          <span class="formula-chip">人数系数 ${formatPlain(calc.sizeCoef)}</span>
          <span class="formula-chip">调整系数 ${formatPlain(calc.adjustmentCoef)}</span>
        </div>

        <div class="formula-value">
          <div>
            <span class="tiny-label">折算课时</span>
            <strong class="mono">${formatNumber(calc.settledHours)}</strong>
          </div>
          <div class="text-right">
            <span class="tiny-label">课时费</span>
            <strong class="mono">${formatCurrency(calc.amount)}</strong>
          </div>
        </div>

        <div class="formula-breakdown">
          <div class="formula-row"><span>基础课时</span><strong>${formatNumber(calc.baseHours)}</strong></div>
          <div class="formula-row"><span>额外课时</span><strong>${formatNumber(calc.extraHours)}</strong></div>
          <div class="formula-row"><span>人数区间</span><strong>${escapeHtml(calc.sizeBand)}</strong></div>
          <div class="formula-row"><span>计算公式</span><strong>(${formatNumber(calc.baseHours)} + ${formatNumber(calc.extraHours)}) × ${formatPlain(calc.typeCoef)} × ${formatPlain(calc.sizeCoef)} × ${formatPlain(calc.adjustmentCoef)}</strong></div>
          <div class="formula-row"><span>课时单价</span><strong>${formatCurrency(calc.unitPrice)}</strong></div>
        </div>
      </div>

      ${
        needsReason
          ? `
            <div class="muted-card spaced">
              <strong>审核提醒</strong>
              <p class="muted">当前填写了额外课时或调整系数，提交前请在备注中说明依据，否则申报会被驳回。</p>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderPasswordField({ id, name, label, placeholder, autocomplete }) {
  return `
    <label class="field-stack">
      <span class="field-label">${escapeHtml(label)}</span>
      <div class="password-field">
        <input id="${escapeHtml(id)}" name="${escapeHtml(name)}" type="password" placeholder="${escapeHtml(placeholder)}" autocomplete="${escapeHtml(autocomplete)}" />
        <button class="toggle-button" type="button" data-action="toggle-password" data-target="${escapeHtml(id)}">显示</button>
      </div>
    </label>
  `;
}

function renderStatusBadge(status) {
  const meta = STATUS_META[status] || { label: "未知状态", tone: "info" };
  return `<span class="status-badge ${escapeHtml(meta.tone)}">${escapeHtml(meta.label)}</span>`;
}

function renderAccountStatusBadge(status) {
  const meta = ACCOUNT_STATUS_META[status] || { label: "未知状态", tone: "info" };
  return `<span class="status-badge ${escapeHtml(meta.tone)}">${escapeHtml(meta.label)}</span>`;
}

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;

  if (action === "dismiss-notice") {
    clearNotice();
    return;
  }

  if (action === "logout") {
    clearSession();
    resetUiState();
    setNotice("已成功退出登录。", "success");
    navigate("/");
    return;
  }

  if (action === "fill-demo") {
    fillDemoLogin(button.dataset.role);
    return;
  }

  if (action === "toggle-password") {
    togglePasswordVisibility(button);
    return;
  }

  if (action === "reset-claim") {
    const user = getCurrentUser();
    if (user?.role === "teacher") {
      clearTeacherClaimDraft(user.id);
    }
    ui.teacherEditId = null;
    renderApp({ reason: "state" });
    setNotice("表单已重置。", "info");
    return;
  }

  if (action === "cancel-edit") {
    ui.teacherEditId = null;
    renderApp({ reason: "state" });
    setNotice("已退出编辑模式。", "info");
    return;
  }

  if (action === "edit-claim") {
    const item = findClaim(button.dataset.id);
    if (!item || !canEditClaim(item)) {
      setNotice("当前记录不可编辑。", "error");
      return;
    }
    ui.teacherEditId = item.id;
    renderApp({ reason: "state" });
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if (action === "open-review") {
    const item = findClaim(button.dataset.id);
    if (!item) {
      setNotice("未找到对应申报记录。", "error");
      return;
    }
    ui.reviewId = item.id;
    ui.reviewNote = "";
    renderApp({ reason: "state" });
    return;
  }

  if (action === "quick-approve") {
    applyReview(button.dataset.id, "approved", ui.reviewId === button.dataset.id ? ui.reviewNote : "");
    return;
  }

  if (action === "quick-return") {
    applyReview(button.dataset.id, "returned", ui.reviewId === button.dataset.id ? ui.reviewNote : "");
    return;
  }

  if (action === "approve-selected") {
    approveSelected();
    return;
  }

  if (action === "export-selected") {
    exportSelected();
    return;
  }

  if (action === "export-filtered") {
    exportFiltered();
    return;
  }

  if (action === "send-reminder-selected") {
    sendReminderSelected();
    return;
  }

  if (action === "approve-teacher-account") {
    updateTeacherApproval(button.dataset.id, "approved");
    return;
  }

  if (action === "reject-teacher-account") {
    updateTeacherApproval(button.dataset.id, "rejected");
    return;
  }

  if (action === "delete-course-type") {
    deleteCourseType(button.dataset.id);
    return;
  }

  if (action === "download-import-template") {
    downloadTeacherImportTemplate();
    return;
  }

  if (action === "clear-filters") {
    ui.adminFilters = { ...DEFAULT_FILTERS };
    ui.selectedIds.clear();
    ui.reviewId = null;
    ui.reviewNote = "";
    renderApp({ reason: "state" });
    setNotice("筛选条件已清空。", "info");
    return;
  }

  if (action === "reset-demo") {
    const confirmed = window.confirm("确认重置当前浏览器中的演示数据，并恢复默认账号与示例记录吗？");
    if (!confirmed) return;

    store = createInitialStore();
    persistStore();
    resetUiState();
    setNotice("演示数据已重置。", "success");
    navigate("/");
  }
}

function handleSubmit(event) {
  const form = event.target;

  if (form.id === "teacher-login-form") {
    event.preventDefault();
    login(form, "teacher");
    return;
  }

  if (form.id === "admin-login-form") {
    event.preventDefault();
    login(form, "admin");
    return;
  }

  if (form.id === "register-form") {
    event.preventDefault();
    register(form);
    return;
  }

  if (form.id === "teacher-claim-form") {
    event.preventDefault();
    submitClaim(form);
    return;
  }

  if (form.id === "admin-filter-form") {
    event.preventDefault();
    const data = new FormData(form);
    ui.adminFilters = {
      status: String(data.get("status") || "all"),
      semester: String(data.get("semester") || "all"),
      keyword: cleanText(data.get("keyword")),
    };
    ui.selectedIds.clear();
    renderApp({ reason: "state" });
    return;
  }

  if (form.id === "review-form") {
    event.preventDefault();
    const decision = event.submitter?.value;
    if (!decision) return;
    const data = new FormData(form);
    applyReview(form.dataset.id, decision, cleanMultilineText(data.get("reviewNote")));
    return;
  }

  if (form.id === "teacher-import-form") {
    event.preventDefault();
    importTeachersFromCsv(form);
    return;
  }

  if (form.id === "course-type-form") {
    event.preventDefault();
    addCourseType(form);
  }
}

function handleInput(event) {
  const target = event.target;

  if (target.closest("#teacher-claim-form")) {
    syncClaimPreview();

    const user = getCurrentUser();
    if (user?.role === "teacher" && !ui.teacherEditId) {
      saveTeacherClaimDraft(user.id, readClaimDraft(new FormData(target.closest("form"))));
    }
    return;
  }

  if (target.name === "reviewNote") {
    ui.reviewNote = target.value;
    return;
  }

  if (target.closest("#teacher-login-form")) {
    syncAuthFeedback("teacher");
    return;
  }

  if (target.closest("#admin-login-form")) {
    syncAuthFeedback("admin");
  }
}

function handleChange(event) {
  const target = event.target;

  if (target.dataset.role === "select-one") {
    const id = target.dataset.id;
    if (!id) return;
    if (target.checked) ui.selectedIds.add(id);
    else ui.selectedIds.delete(id);
    syncAdminSelectionUI();
    return;
  }

  if (target.dataset.role === "select-all") {
    const ids = filterClaims(sortClaims(getClaims())).map((item) => item.id);
    if (target.checked) ids.forEach((id) => ui.selectedIds.add(id));
    else ids.forEach((id) => ui.selectedIds.delete(id));
    syncAdminSelectionUI();
  }
}

function login(form, role) {
  const data = new FormData(form);
  const username = cleanText(data.get("username")).toLowerCase();
  const password = String(data.get("password") || "");

  if (!username || !password) {
    const message = "请输入用户名和密码。";
    setAuthFeedback(role, "error", message);
    setNotice(message, "error");
    return;
  }

  const security = getLoginSecurityState(role, username);
  if (security.locked) {
    const message = `该账号已被临时锁定，请在 ${formatDateTime(security.lockedUntil)} 后重试。`;
    setAuthFeedback(role, "error", message);
    setNotice(message, "error");
    return;
  }

  const user = store.users.find((item) => item.role === role && item.username.toLowerCase() === username);

  if (!user || user.password !== password) {
    const nextState = registerFailedLogin(role, username);
    const message = nextState.locked
      ? `用户名或密码错误，已达到上限，账号已锁定 ${LOGIN_POLICY.lockMinutes} 分钟。`
      : `用户名或密码错误，还可尝试 ${nextState.attemptsLeft} 次。`;
    setAuthFeedback(role, "error", message);
    setNotice(message, "error");
    return;
  }

  if (role === "teacher" && !isTeacherApproved(user)) {
    const message =
      user.approvalStatus === "rejected"
        ? "该教师账号审核未通过，请联系管理员确认后重新注册。"
        : "该教师账号尚未通过管理员审核，请等待处理后再登录。";
    setAuthFeedback(role, "error", message);
    setNotice(message, "error");
    return;
  }

  clearLoginSecurity(role, username);
  clearAuthFeedback(role);
  store.session = {
    userId: user.id,
    role: user.role,
    loginAt: new Date().toISOString(),
  };
  persistStore();

  setNotice(`已成功登录${role === "teacher" ? "教师端" : "管理员端"}。`, "success");
  navigate(role === "teacher" ? "/teacher" : "/admin");
}

function register(form) {
  const role = form.dataset.role;
  const data = new FormData(form);
  const name = cleanText(data.get("name"));
  const username = cleanText(data.get("username"));
  const email = cleanText(data.get("email"));
  const department = cleanText(data.get("department"));
  const employeeNo = cleanText(data.get("employeeNo"));
  const password = String(data.get("password") || "");
  const passwordConfirm = String(data.get("passwordConfirm") || "");

  if (!name || !username || !email || !department || !employeeNo || !password || !passwordConfirm) {
    setNotice("请完整填写注册信息。", "error");
    return;
  }

  if (!isEmail(email)) {
    setNotice("请输入有效的邮箱地址。", "error");
    return;
  }

  if (!isStrongEnoughPassword(password)) {
    setNotice("密码至少 8 位，并建议同时包含字母和数字。", "error");
    return;
  }

  if (password !== passwordConfirm) {
    setNotice("两次输入的密码不一致。", "error");
    return;
  }

  if (!/^[a-zA-Z0-9._-]{4,32}$/.test(username)) {
    setNotice("用户名需为 4-32 位，只能包含字母、数字、点、下划线或短横线。", "error");
    return;
  }

  if (store.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
    setNotice("该用户名已存在，请更换一个。", "error");
    return;
  }

  if (store.users.some((item) => item.email.toLowerCase() === email.toLowerCase())) {
    setNotice("该邮箱已存在，请使用其他邮箱。", "error");
    return;
  }

  if (store.users.some((item) => cleanText(item.employeeNo).toLowerCase() === employeeNo.toLowerCase())) {
    setNotice("该工号已存在，请确认后重试。", "error");
    return;
  }

  const now = new Date().toISOString();
  const user = {
    id: createId(role),
    role,
    name,
    username,
    email,
    password,
    department,
    employeeNo,
    createdAt: now,
    updatedAt: now,
    approvalStatus: role === "teacher" ? "pending" : "approved",
    approvedAt: role === "teacher" ? "" : now,
    approvedBy: role === "teacher" ? "" : "self",
    source: role === "teacher" ? "register" : "self-register",
  };

  store.users.push(user);
  persistStore();

  if (role === "teacher") {
    recordActivity({ name: "系统", role: "system" }, `收到教师注册申请：${user.name}（${user.department}）`);
    clearAuthFeedback("teacher");
    setNotice("教师注册申请已提交，请等待管理员审核通过后再登录。", "success");
    navigate("/teacher-login");
    return;
  }

  store.session = {
    userId: user.id,
    role: user.role,
    loginAt: now,
  };
  persistStore();
  recordActivity({ name: user.name, role: user.role }, "创建了新的管理员账号并登录。");
  setNotice("管理员账号已创建并自动登录。", "success");
  navigate("/admin");
}

function submitClaim(form) {
  const user = getCurrentUser();
  if (!user || user.role !== "teacher") return;

  const existing = ui.teacherEditId ? findClaim(ui.teacherEditId) : null;
  if (existing && (existing.teacherId !== user.id || !canEditClaim(existing))) {
    setNotice("当前记录不可编辑。", "error");
    return;
  }

  const raw = readClaimDraft(new FormData(form));
  const validationError = validateClaim(raw);
  if (validationError) {
    setNotice(validationError, "error");
    return;
  }

  if (hasDuplicateClaim(raw, user.id, existing?.id)) {
    setNotice("相同学期、课程代码和教学班的申报记录已存在，请直接编辑原记录。", "error");
    return;
  }

  const calc = calculateClaim(raw);
  const now = new Date().toISOString();
  const record = {
    id: existing?.id || createId("claim"),
    teacherId: user.id,
    teacherName: user.name,
    employeeNo: user.employeeNo,
    department: user.department,
    semester: raw.semester,
    courseType: calc.courseType,
    courseName: raw.courseName,
    courseCode: raw.courseCode,
    className: raw.className,
    studentCount: calc.studentCount,
    weeks: calc.weeks,
    weeklyHours: calc.weeklyHours,
    extraHours: calc.extraHours,
    adjustmentCoef: calc.adjustmentCoef,
    baseHours: calc.baseHours,
    typeCoef: calc.typeCoef,
    sizeCoef: calc.sizeCoef,
    sizeBand: calc.sizeBand,
    settledHours: calc.settledHours,
    unitPrice: calc.unitPrice,
    amount: calc.amount,
    remarks: raw.remarks,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    submittedAt: now,
    status: "pending",
    approvalNote: existing?.approvalNote || "",
    reviewedAt: "",
    reviewerId: "",
    reviewerName: "",
    reminderCount: existing?.reminderCount || 0,
    lastReminderAt: existing?.lastReminderAt || "",
    revisionCount: existing ? (existing.revisionCount || 0) + 1 : 0,
  };

  const claims = getClaims();
  setClaims(existing ? claims.map((item) => (item.id === existing.id ? record : item)) : [...claims, record]);
  clearTeacherClaimDraft(user.id);
  ui.teacherEditId = null;

  recordActivity({ name: user.name, role: user.role }, `${existing ? "重新提交" : "提交"}了《${record.courseName}》${record.className} 的课时申报。`);
  setNotice(existing ? "申报已更新并重新提交。" : "课时申报提交成功。", "success");
  renderApp({ reason: "state" });
}

function validateClaim(raw) {
  if (!raw.courseName) return "课程名称不能为空。";
  if (!raw.courseCode) return "课程代码不能为空。";
  if (!raw.className) return "教学班名称不能为空。";
  if (!getCourseMap()[raw.courseType]) return "课程类型无效，请重新选择。";
  if (!Number.isFinite(raw.studentCount) || raw.studentCount < 1) return "学生人数必须大于 0。";
  if (!Number.isFinite(raw.weeks) || raw.weeks < 1 || raw.weeks > 30) return "授课周数必须在 1 到 30 之间。";
  if (!Number.isFinite(raw.weeklyHours) || raw.weeklyHours <= 0 || raw.weeklyHours > 12) return "周学时必须大于 0 且不超过 12。";
  if (!Number.isFinite(raw.extraHours) || raw.extraHours < 0 || raw.extraHours > 120) return "额外课时必须在 0 到 120 之间。";
  if (!Number.isFinite(raw.adjustmentCoef) || raw.adjustmentCoef < 0.5 || raw.adjustmentCoef > 2) return "调整系数必须在 0.5 到 2 之间。";

  if ((raw.extraHours > 0 || raw.adjustmentCoef !== 1) && cleanMultilineText(raw.remarks).length < 6) {
    return "填写额外课时或调整系数时，备注说明至少需要 6 个字。";
  }

  return "";
}

function hasDuplicateClaim(raw, userId, ignoreId) {
  const compareCourseCode = normalizeCompare(raw.courseCode);
  const compareClassName = normalizeCompare(raw.className);

  return getClaims().some(
    (item) =>
      item.teacherId === userId &&
      item.id !== ignoreId &&
      normalizeCompare(item.semester) === normalizeCompare(raw.semester) &&
      normalizeCompare(item.courseCode) === compareCourseCode &&
      normalizeCompare(item.className) === compareClassName
  );
}

function applyReview(id, decision, note) {
  const admin = getCurrentUser();
  if (!admin || admin.role !== "admin") return;

  const claims = getClaims();
  const item = claims.find((entry) => entry.id === id);
  if (!item) {
    setNotice("未找到对应申报记录。", "error");
    return;
  }

  if (item.status !== "pending") {
    setNotice("只有待审批记录才能处理，退回记录需教师重新提交后再审批。", "error");
    return;
  }

  const nextStatus = decision === "approved" ? "approved" : "returned";
  const reviewNote = note || defaultReviewNote(nextStatus);
  const now = new Date().toISOString();

  setClaims(
    claims.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            status: nextStatus,
            approvalNote: reviewNote,
            reviewedAt: now,
            reviewerId: admin.id,
            reviewerName: admin.name,
            updatedAt: now,
          }
        : entry
    )
  );

  ui.selectedIds.delete(id);
  ui.reviewId = id;
  ui.reviewNote = "";

  recordActivity({ name: admin.name, role: admin.role }, `${nextStatus === "approved" ? "审批通过" : "退回修改"}了《${item.courseName}》${item.className} 的课时申报。`);
  setNotice(nextStatus === "approved" ? "已审批通过该记录。" : "该记录已退回给教师修改。", "success");
  renderApp({ reason: "state" });
}

function approveSelected() {
  const admin = getCurrentUser();
  if (!admin || admin.role !== "admin") return;

  const claims = getClaims();
  const pendingSelected = claims.filter((item) => ui.selectedIds.has(item.id) && item.status === "pending");
  if (!pendingSelected.length) {
    setNotice("当前选中记录中没有待审批项。", "error");
    return;
  }

  const now = new Date().toISOString();
  const idSet = new Set(pendingSelected.map((item) => item.id));

  setClaims(
    claims.map((item) =>
      idSet.has(item.id)
        ? {
            ...item,
            status: "approved",
            approvalNote: item.approvalNote || "批量审批通过。",
            reviewedAt: now,
            reviewerId: admin.id,
            reviewerName: admin.name,
            updatedAt: now,
          }
        : item
    )
  );

  idSet.forEach((id) => ui.selectedIds.delete(id));
  recordActivity({ name: admin.name, role: admin.role }, `批量审批通过了 ${pendingSelected.length} 条申报记录。`);
  setNotice(`已批量通过 ${pendingSelected.length} 条记录。`, "success");
  renderApp({ reason: "state" });
}

function exportSelected() {
  const items = sortClaims(getClaims().filter((item) => ui.selectedIds.has(item.id)));
  if (!items.length) {
    setNotice("请先选择至少一条记录再导出。", "error");
    return;
  }

  exportCsv(items, "selected");
  setNotice(`已导出 ${items.length} 条选中记录。`, "success");
}

function exportFiltered() {
  const items = filterClaims(sortClaims(getClaims()));
  if (!items.length) {
    setNotice("当前筛选条件下没有可导出的数据。", "error");
    return;
  }

  exportCsv(items, "filtered");
  setNotice(`已导出 ${items.length} 条筛选结果。`, "success");
}

function updateTeacherApproval(id, nextStatus) {
  const admin = getCurrentUser();
  if (!admin || admin.role !== "admin") return;

  const user = store.users.find((item) => item.id === id && item.role === "teacher");
  if (!user) {
    setNotice("未找到对应教师账号。", "error");
    return;
  }

  if (user.approvalStatus === nextStatus) {
    setNotice("该教师账号已经是当前状态。", "info");
    return;
  }

  user.approvalStatus = nextStatus;
  user.approvedAt = nextStatus === "approved" ? new Date().toISOString() : "";
  user.approvedBy = nextStatus === "approved" ? admin.id : "";
  user.updatedAt = new Date().toISOString();
  persistStore();

  recordActivity({ name: admin.name, role: admin.role }, `${nextStatus === "approved" ? "通过" : "拒绝"}了教师账号 ${user.name}。`);
  setNotice(nextStatus === "approved" ? `已通过教师账号：${user.name}` : `已拒绝教师账号：${user.name}`, "success");
  renderApp({ reason: "state" });
}

function sendReminderSelected() {
  const admin = getCurrentUser();
  if (!admin || admin.role !== "admin") return;

  const claims = getClaims();
  const selectedClaims = claims.filter((item) => ui.selectedIds.has(item.id) && (item.status === "pending" || item.status === "returned"));
  if (!selectedClaims.length) {
    setNotice("请先勾选需要提醒的待审批或已退回记录。", "error");
    return;
  }

  const userMap = Object.fromEntries(store.users.map((item) => [item.id, item]));
  const recipients = Array.from(
    new Set(
      selectedClaims
        .map((item) => userMap[item.teacherId]?.email)
        .filter((email) => email && isEmail(email))
    )
  );

  if (!recipients.length) {
    setNotice("选中记录未匹配到有效邮箱，无法发送提醒。", "error");
    return;
  }

  const now = new Date().toISOString();
  const teacherSummary = new Map();
  selectedClaims.forEach((item) => {
    if (!teacherSummary.has(item.teacherId)) {
      teacherSummary.set(item.teacherId, { name: item.teacherName, pending: 0, returned: 0 });
    }
    const current = teacherSummary.get(item.teacherId);
    if (item.status === "pending") current.pending += 1;
    if (item.status === "returned") current.returned += 1;
  });

  const body = [
    "各位老师，您好：",
    "",
    "以下是您当前课时申报记录的处理提醒，请及时查看并处理：",
    "",
    ...Array.from(teacherSummary.values()).map((item) => `${item.name}：待审批 ${item.pending} 条，已退回 ${item.returned} 条。`),
    "",
    "如有退回记录，请根据反馈修改后重新提交。",
    "",
    `发送时间：${formatDateTime(now)}`,
    `发送人：${admin.name}`,
  ].join("\n");

  const link = `mailto:?bcc=${encodeURIComponent(recipients.join(","))}&subject=${encodeURIComponent("【课时申报提醒】请及时处理待办记录")}&body=${encodeURIComponent(body)}`;
  window.location.href = link;

  const selectedSet = new Set(selectedClaims.map((item) => item.id));
  setClaims(
    claims.map((item) =>
      selectedSet.has(item.id)
        ? {
            ...item,
            reminderCount: (item.reminderCount || 0) + 1,
            lastReminderAt: now,
            updatedAt: now,
          }
        : item
    )
  );

  recordActivity({ name: admin.name, role: admin.role }, `为 ${recipients.length} 位教师准备了申报提醒邮件。`);
  setNotice(`已准备提醒邮件，收件教师 ${recipients.length} 人。`, "success");
  renderApp({ reason: "state" });
}

function addCourseType(form) {
  const admin = getCurrentUser();
  if (!admin || admin.role !== "admin") return;

  const data = new FormData(form);
  const label = cleanText(data.get("label"));
  const desc = cleanText(data.get("desc"));
  const coef = Number(data.get("coef"));
  const price = Number(data.get("price"));

  if (!label) {
    setNotice("课程模式名称不能为空。", "error");
    return;
  }
  if (!Number.isFinite(coef) || coef <= 0 || coef > 5) {
    setNotice("课程系数需在 0 到 5 之间。", "error");
    return;
  }
  if (!Number.isFinite(price) || price <= 0) {
    setNotice("课时单价必须大于 0。", "error");
    return;
  }
  if (getCourseTypes().some((item) => normalizeCompare(item.label) === normalizeCompare(label))) {
    setNotice("课程模式名称已存在，请使用其他名称。", "error");
    return;
  }

  setCourseTypes(
    getCourseTypes().concat({
      id: createId("course"),
      label,
      coef: round2(coef),
      price: round2(price),
      desc: desc || "管理员新增课程模式。",
    })
  );

  form.reset();
  recordActivity({ name: admin.name, role: admin.role }, `新增了课程模式“${label}”。`);
  setNotice(`已新增课程模式：${label}。`, "success");
  renderApp({ reason: "state" });
}

function deleteCourseType(id) {
  const admin = getCurrentUser();
  if (!admin || admin.role !== "admin") return;

  const list = getCourseTypes();
  const target = list.find((item) => item.id === id);
  if (!target) {
    setNotice("未找到对应课程模式。", "error");
    return;
  }
  if (list.length <= 1) {
    setNotice("至少需要保留一个课程模式。", "error");
    return;
  }
  if (getClaims().some((item) => item.courseType === id)) {
    setNotice("该课程模式已被申报记录使用，暂不允许删除。", "error");
    return;
  }

  setCourseTypes(list.filter((item) => item.id !== id));
  recordActivity({ name: admin.name, role: admin.role }, `删除了课程模式“${target.label}”。`);
  setNotice(`已删除课程模式：${target.label}。`, "success");
  renderApp({ reason: "state" });
}

function importTeachersFromCsv(form) {
  const admin = getCurrentUser();
  if (!admin || admin.role !== "admin") return;

  const fileInput = form.querySelector("input[name=teacherCsvFile]");
  const defaultPassword = String(form.querySelector("input[name=defaultPassword]")?.value || "").trim() || "Demo123!";
  const defaultDepartment = cleanText(form.querySelector("select[name=defaultDepartment]")?.value) || DEPARTMENTS[0];
  const file = fileInput?.files?.[0];

  if (!file) {
    setNotice("请先选择 CSV 文件。", "error");
    return;
  }
  if (!isStrongEnoughPassword(defaultPassword)) {
    setNotice("默认密码至少 8 位，并建议包含字母和数字。", "error");
    return;
  }

  file
    .text()
    .then((raw) => {
      const rows = parseCsvRows(raw);
      if (rows.length < 2) {
        setNotice("CSV 内容为空或缺少数据行。", "error");
        return;
      }

      const headerMap = mapTeacherCsvHeader(rows[0]);
      if (headerMap.name === undefined || headerMap.username === undefined || headerMap.email === undefined) {
        setNotice("CSV 表头缺少必要字段：姓名、用户名、邮箱。", "error");
        return;
      }

      const existingUsernames = new Set(store.users.map((item) => item.username.toLowerCase()));
      const existingEmployeeNos = new Set(store.users.map((item) => cleanText(item.employeeNo).toLowerCase()));
      const fileUsernames = new Set();
      const fileEmployeeNos = new Set();
      const addList = [];
      let skipped = 0;

      for (let idx = 1; idx < rows.length; idx += 1) {
        const row = rows[idx];
        if (!row || row.every((cell) => !cleanText(cell))) continue;

        const name = cleanText(row[headerMap.name]);
        const username = cleanText(row[headerMap.username]).toLowerCase();
        const email = cleanText(row[headerMap.email]);
        const department = cleanText(row[headerMap.department]) || defaultDepartment;
        const employeeNo = cleanText(row[headerMap.employeeNo]) || `T${Date.now().toString().slice(-6)}${String(idx).padStart(2, "0")}`;
        const password = String(cleanText(row[headerMap.password]) || defaultPassword);

        if (!name || !username || !isEmail(email) || !isStrongEnoughPassword(password)) {
          skipped += 1;
          continue;
        }
        if (!/^[a-zA-Z0-9._-]{4,32}$/.test(username)) {
          skipped += 1;
          continue;
        }
        if (
          existingUsernames.has(username) ||
          fileUsernames.has(username) ||
          existingEmployeeNos.has(employeeNo.toLowerCase()) ||
          fileEmployeeNos.has(employeeNo.toLowerCase())
        ) {
          skipped += 1;
          continue;
        }

        fileUsernames.add(username);
        fileEmployeeNos.add(employeeNo.toLowerCase());
        addList.push({
          id: createId("teacher"),
          role: "teacher",
          name,
          username,
          email,
          password,
          department,
          employeeNo,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          approvalStatus: "approved",
          approvedAt: new Date().toISOString(),
          approvedBy: admin.id,
          source: "import",
        });
      }

      if (!addList.length) {
        setNotice("未导入任何账号，请检查表格字段和数据格式。", "error");
        return;
      }

      store.users.push(...addList);
      persistStore();
      form.reset();
      recordActivity({ name: admin.name, role: admin.role }, `批量导入了 ${addList.length} 个教师账号，跳过 ${skipped} 行。`);
      setNotice(`导入完成：新增 ${addList.length} 个教师账号，跳过 ${skipped} 行。`, "success");
      renderApp({ reason: "state" });
    })
    .catch(() => {
      setNotice("读取 CSV 文件失败，请重试。", "error");
    });
}

function mapTeacherCsvHeader(headerRow) {
  const map = {};

  headerRow.forEach((raw, index) => {
    const key = cleanText(raw).replace(/^\ufeff/, "").replace(/\s+/g, "").toLowerCase();
    if (["姓名", "name", "teachername"].includes(key)) map.name = index;
    if (["用户名", "username", "loginname", "账号"].includes(key)) map.username = index;
    if (["邮箱", "email", "mail"].includes(key)) map.email = index;
    if (["所属院系", "院系", "department"].includes(key)) map.department = index;
    if (["工号", "教师工号", "employeeno", "jobno"].includes(key)) map.employeeNo = index;
    if (["密码", "password"].includes(key)) map.password = index;
  });

  return map;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const input = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (ch === "\"") {
      if (inQuotes && input[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (ch === "\n" && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function downloadTeacherImportTemplate() {
  const csv = [
    ["姓名", "用户名", "邮箱", "所属院系", "工号", "密码"].map(csvEscape).join(","),
    ["王敏", "wang.teacher", "wang@demo.edu", "计算机学院", "T2026010", "Demo123!"].map(csvEscape).join(","),
    ["周凯", "zhou.teacher", "zhou@demo.edu", "人工智能学院", "T2026011", "Demo123!"].map(csvEscape).join(","),
  ].join("\n");

  downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), `教师账号导入模板-${formatDateForFile(new Date())}.csv`);
  setNotice("已下载教师导入模板。", "success");
}

function fillDemoLogin(role) {
  const form = document.getElementById(`${role}-login-form`);
  if (!form) return;

  const userField = form.querySelector("input[name=username]");
  const passField = form.querySelector("input[name=password]");
  if (!userField || !passField) return;

  userField.value = role === "teacher" ? "zhang.teacher" : "admin";
  passField.value = "Demo123!";
  clearAuthFeedback(role);
  syncAuthFeedback(role);
}

function togglePasswordVisibility(button) {
  const targetId = button.dataset.target;
  if (!targetId) return;

  const input = document.getElementById(targetId);
  if (!input) return;

  input.type = input.type === "password" ? "text" : "password";
  button.textContent = input.type === "password" ? "显示" : "隐藏";
}

function syncClaimPreview() {
  const form = document.getElementById("teacher-claim-form");
  const box = document.getElementById("claim-preview");
  if (!form || !box) return;

  box.innerHTML = renderClaimPreview(readClaimDraft(new FormData(form)));
}

function syncDraftStatus(user = getCurrentUser()) {
  const box = document.querySelector("[data-draft-status]");
  if (!box || !user || user.role !== "teacher") return;

  if (ui.teacherEditId) {
    box.textContent = "正在编辑已有记录，提交后会重新进入待审批。";
    return;
  }

  const draft = getTeacherClaimDraft(user.id);
  if (!draft) {
    box.textContent = "填写中的内容会自动保存为草稿。";
    return;
  }

  box.textContent = ui.teacherDraftTouchedAt ? `草稿已自动保存于 ${formatTime(ui.teacherDraftTouchedAt)}。` : "已恢复你上次未提交的草稿。";
}

function syncAuthFeedback(role) {
  const box = document.querySelector(`[data-auth-feedback="${role}"]`);
  if (!box) return;

  const form = document.getElementById(`${role}-login-form`);
  const username = cleanText(form?.querySelector("input[name=username]")?.value || "").toLowerCase();
  const feedback = ui.authFeedback[role];
  const securityState = username ? getLoginSecurityState(role, username) : null;
  const securityMessage = securityState?.locked
    ? `当前账号已锁定至 ${formatDateTime(securityState.lockedUntil)}。`
    : username
      ? `连续输错 ${LOGIN_POLICY.maxAttempts} 次会锁定 ${LOGIN_POLICY.lockMinutes} 分钟；当前剩余 ${securityState.attemptsLeft} 次。`
      : `为保护账号安全，连续输错 ${LOGIN_POLICY.maxAttempts} 次后会锁定 ${LOGIN_POLICY.lockMinutes} 分钟。`;

  box.innerHTML = `
    ${feedback ? `<div class="inline-feedback ${escapeHtml(feedback.type || "info")}">${escapeHtml(feedback.message)}</div>` : ""}
    <div class="security-note">${escapeHtml(securityMessage)}</div>
  `;
}

function syncAdminSelectionUI() {
  if (getRoute() !== "/admin") return;

  const claims = filterClaims(sortClaims(getClaims()));
  const visibleIds = claims.map((item) => item.id);
  const selectedVisibleCount = visibleIds.filter((id) => ui.selectedIds.has(id)).length;

  document.querySelectorAll("[data-selected-summary]").forEach((node) => {
    node.textContent = selectedVisibleCount ? `已选中 ${selectedVisibleCount} 条` : "未选择任何记录";
  });
  document.querySelectorAll("[data-selected-summary-option]").forEach((node) => {
    node.textContent = selectedVisibleCount ? `已选中 ${selectedVisibleCount} 条` : "未选择任何记录";
  });
  document.querySelectorAll("[data-requires-selection]").forEach((node) => {
    node.disabled = selectedVisibleCount === 0;
  });

  const selectAll = document.querySelector("[data-role='select-all']");
  if (selectAll) {
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => ui.selectedIds.has(id));
    selectAll.checked = allSelected;
    selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
  }

  document.querySelectorAll("[data-role='select-one']").forEach((node) => {
    node.checked = ui.selectedIds.has(node.dataset.id);
  });
}

function readClaimDraft(formData) {
  const defaultCourse = getCourseTypes()[0];

  return {
    semester: cleanText(formData.get("semester")) || guessCurrentSemester(),
    courseType: cleanText(formData.get("courseType")) || defaultCourse?.id || "required",
    courseName: cleanText(formData.get("courseName")),
    courseCode: cleanText(formData.get("courseCode")).toUpperCase(),
    className: cleanText(formData.get("className")),
    studentCount: Number(formData.get("studentCount") || 0),
    weeks: Number(formData.get("weeks") || 16),
    weeklyHours: Number(formData.get("weeklyHours") || 2),
    extraHours: Number(formData.get("extraHours") || 0),
    adjustmentCoef: Number(formData.get("adjustmentCoef") || 1),
    remarks: cleanMultilineText(formData.get("remarks")),
  };
}

function calculateClaim(values, courseMap = getCourseMap()) {
  const course = findCourseType(values.courseType, courseMap);
  const studentCount = toPositiveNumber(values.studentCount);
  const weeks = toPositiveNumber(values.weeks);
  const weeklyHours = toPositiveNumber(values.weeklyHours);
  const extraHours = toNonNegativeNumber(values.extraHours);
  const adjustmentCoef = toPositiveNumber(values.adjustmentCoef) || 1;
  const sizeRule = resolveSizeRule(studentCount);
  const baseHours = round2(weeks * weeklyHours);
  const settledHours = round2((baseHours + extraHours) * course.coef * sizeRule.coef * adjustmentCoef);
  const amount = round2(settledHours * course.price);

  return {
    courseType: course.id,
    studentCount,
    weeks,
    weeklyHours,
    extraHours,
    adjustmentCoef: round2(adjustmentCoef),
    baseHours,
    typeCoef: course.coef,
    sizeCoef: sizeRule.coef,
    sizeBand: sizeRule.label,
    settledHours,
    unitPrice: course.price,
    amount,
  };
}

function filterClaims(claims) {
  const keyword = ui.adminFilters.keyword.trim().toLowerCase();

  return claims.filter((item) => {
    const statusOk = ui.adminFilters.status === "all" || item.status === ui.adminFilters.status;
    const semesterOk = ui.adminFilters.semester === "all" || item.semester === ui.adminFilters.semester;
    const keywordOk =
      !keyword ||
      [item.teacherName, item.courseName, item.className, item.department, item.employeeNo]
        .join(" ")
        .toLowerCase()
        .includes(keyword);

    return statusOk && semesterOk && keywordOk;
  });
}

function getTeacherClaims(userId) {
  return sortClaims(getClaims().filter((item) => item.teacherId === userId));
}

function getTeacherStats(claims) {
  const approved = claims.filter((item) => item.status === "approved");
  return {
    pendingCount: claims.filter((item) => item.status === "pending").length,
    returnedCount: claims.filter((item) => item.status === "returned").length,
    approvedHours: approved.reduce((sum, item) => sum + item.settledHours, 0),
    approvedAmount: approved.reduce((sum, item) => sum + item.amount, 0),
  };
}

function getAdminStats(claims) {
  const approved = claims.filter((item) => item.status === "approved");
  return {
    pendingCount: claims.filter((item) => item.status === "pending").length,
    approvedHours: approved.reduce((sum, item) => sum + item.settledHours, 0),
    approvedAmount: approved.reduce((sum, item) => sum + item.amount, 0),
    teacherCount: new Set(claims.map((item) => item.teacherId)).size,
  };
}

function getReviewItem(allClaims, filteredClaims) {
  const item = ui.reviewId ? allClaims.find((entry) => entry.id === ui.reviewId) : filteredClaims[0] || null;
  if (item && ui.reviewId !== item.id) {
    ui.reviewId = item.id;
    ui.reviewNote = "";
  }
  return item;
}

function sortClaims(claims) {
  return claims
    .slice()
    .sort((a, b) => {
      const order = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      if (order !== 0) return order;
      return String(b.submittedAt || "").localeCompare(String(a.submittedAt || ""));
    });
}

function exportCsv(items, scope) {
  const header = [
    "申报编号",
    "状态",
    "学期",
    "教师姓名",
    "教师工号",
    "所属院系",
    "课程名称",
    "课程代码",
    "课程类型",
    "教学班名称",
    "学生人数",
    "授课周数",
    "周学时",
    "额外课时",
    "调整系数",
    "基础课时",
    "课程系数",
    "人数系数",
    "折算课时",
    "课时单价",
    "课时费",
    "最近提交时间",
    "最近审批时间",
    "提醒次数",
    "最近提醒时间",
    "审批意见",
    "修改次数",
  ];

  const rows = items.map((item) => [
    item.id,
    statusLabel(item.status),
    item.semester,
    item.teacherName,
    item.employeeNo,
    item.department,
    item.courseName,
    item.courseCode,
    courseLabel(item.courseType),
    item.className,
    item.studentCount,
    item.weeks,
    item.weeklyHours,
    item.extraHours,
    item.adjustmentCoef,
    item.baseHours,
    item.typeCoef,
    item.sizeCoef,
    item.settledHours,
    item.unitPrice,
    item.amount,
    formatDateTime(item.submittedAt),
    formatDateTime(item.reviewedAt),
    item.reminderCount || 0,
    formatDateTime(item.lastReminderAt),
    item.approvalNote,
    item.revisionCount || 0,
  ]);

  const csv = ["\ufeff" + header.map(csvEscape).join(",")]
    .concat(rows.map((row) => row.map(csvEscape).join(",")))
    .join("\n");

  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `课时申报导出-${scope === "selected" ? "选中记录" : "筛选结果"}-${formatDateForFile(new Date())}.csv`);
}

function loadStore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = createInitialStore();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }

    const parsed = JSON.parse(raw);
    const normalized = normalizeStore(parsed);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (_) {
    const initial = createInitialStore();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    } catch (_) {}
    return initial;
  }
}

function normalizeStore(parsed) {
  const safe = parsed && typeof parsed === "object" ? parsed : {};
  const courseTypes = normalizeCourseTypes(safe.courseTypes);
  const courseMap = Object.fromEntries(courseTypes.map((item) => [item.id, item]));

  const users = Array.isArray(safe.users)
    ? safe.users
        .map((user, index) => {
          const role = user?.role === "admin" ? "admin" : "teacher";
          const createdAt = cleanText(user?.createdAt) || new Date().toISOString();
          const approvalStatus =
            role === "admin"
              ? "approved"
              : ["pending", "approved", "rejected"].includes(cleanText(user?.approvalStatus))
                ? cleanText(user?.approvalStatus)
                : "approved";

          return {
            id: cleanText(user?.id) || `${role}-${index + 1}`,
            role,
            name: cleanText(user?.name) || (role === "admin" ? "管理员" : "教师"),
            username: cleanText(user?.username),
            email: cleanText(user?.email),
            password: String(user?.password || ""),
            department: cleanText(user?.department) || (role === "admin" ? "教务处" : DEPARTMENTS[0]),
            employeeNo: cleanText(user?.employeeNo) || `${role === "admin" ? "A" : "T"}${Date.now().toString().slice(-6)}`,
            createdAt,
            updatedAt: cleanText(user?.updatedAt) || createdAt,
            approvalStatus,
            approvedAt: role === "admin" ? cleanText(user?.approvedAt) || createdAt : cleanText(user?.approvedAt),
            approvedBy: role === "admin" ? cleanText(user?.approvedBy) || "system" : cleanText(user?.approvedBy),
            source: cleanText(user?.source) || (role === "admin" ? "system" : "legacy"),
          };
        })
        .filter((user) => user.username)
    : [];

  const claims = Array.isArray(safe.claims || safe.submissions)
    ? (safe.claims || safe.submissions).map((item, index) => normalizeClaim(item, courseMap, index))
    : [];

  const activity = Array.isArray(safe.activity)
    ? safe.activity
        .map((item, index) => ({
          id: cleanText(item?.id) || `log-${index + 1}`,
          actorName: cleanText(item?.actorName) || "系统",
          actorRole: cleanText(item?.actorRole) || "system",
          message: cleanText(item?.message),
          createdAt: cleanText(item?.createdAt) || new Date().toISOString(),
        }))
        .filter((item) => item.message)
    : [];

  const session =
    safe.session && typeof safe.session === "object" && cleanText(safe.session.userId)
      ? {
          userId: cleanText(safe.session.userId),
          role: cleanText(safe.session.role) === "admin" ? "admin" : "teacher",
          loginAt: cleanText(safe.session.loginAt) || new Date().toISOString(),
        }
      : null;

  const loginSecurity = safe.loginSecurity && typeof safe.loginSecurity === "object" && !Array.isArray(safe.loginSecurity) ? safe.loginSecurity : {};
  const drafts = {
    teacherClaims:
      safe.drafts?.teacherClaims && typeof safe.drafts.teacherClaims === "object" && !Array.isArray(safe.drafts.teacherClaims)
        ? safe.drafts.teacherClaims
        : {},
  };

  return {
    version: 4,
    courseTypes,
    users,
    claims,
    session,
    loginSecurity,
    drafts,
    activity,
  };
}

function normalizeCourseTypes(input) {
  if (!Array.isArray(input) || !input.length) {
    return DEFAULT_COURSE_TYPES.map((item) => ({ ...item }));
  }

  const next = input
    .map((item, index) => ({
      id: cleanText(item?.id) || `course-${index + 1}`,
      label: cleanText(item?.label) || `课程模式 ${index + 1}`,
      coef: Number.isFinite(Number(item?.coef)) && Number(item.coef) > 0 ? round2(Number(item.coef)) : 1,
      price: Number.isFinite(Number(item?.price)) && Number(item.price) > 0 ? round2(Number(item.price)) : 120,
      desc: cleanText(item?.desc) || "课程模式说明。",
    }))
    .filter((item) => item.id);

  return next.length ? next : DEFAULT_COURSE_TYPES.map((item) => ({ ...item }));
}

function normalizeClaim(item, courseMap, index) {
  const raw = {
    semester: cleanText(item?.semester) || guessCurrentSemester(),
    courseType: cleanText(item?.courseType) || Object.keys(courseMap)[0],
    courseName: cleanText(item?.courseName) || `课程 ${index + 1}`,
    courseCode: cleanText(item?.courseCode).toUpperCase() || `COURSE-${index + 1}`,
    className: cleanText(item?.className) || `教学班 ${index + 1}`,
    studentCount: Number(item?.studentCount || 0),
    weeks: Number(item?.weeks || 16),
    weeklyHours: Number(item?.weeklyHours || 2),
    extraHours: Number(item?.extraHours || 0),
    adjustmentCoef: Number(item?.adjustmentCoef || 1),
    remarks: cleanMultilineText(item?.remarks),
  };

  const calc = calculateClaim(raw, courseMap);
  const createdAt = cleanText(item?.createdAt) || cleanText(item?.submittedAt) || new Date().toISOString();
  const status = ["pending", "approved", "returned"].includes(cleanText(item?.status)) ? cleanText(item?.status) : "pending";

  return {
    id: cleanText(item?.id) || `claim-${index + 1}`,
    teacherId: cleanText(item?.teacherId) || "",
    teacherName: cleanText(item?.teacherName) || "未命名教师",
    employeeNo: cleanText(item?.employeeNo) || "-",
    department: cleanText(item?.department) || DEPARTMENTS[0],
    semester: raw.semester,
    courseType: calc.courseType,
    courseName: raw.courseName,
    courseCode: raw.courseCode,
    className: raw.className,
    studentCount: calc.studentCount,
    weeks: calc.weeks,
    weeklyHours: calc.weeklyHours,
    extraHours: calc.extraHours,
    adjustmentCoef: calc.adjustmentCoef,
    baseHours: calc.baseHours,
    typeCoef: calc.typeCoef,
    sizeCoef: calc.sizeCoef,
    sizeBand: calc.sizeBand,
    settledHours: calc.settledHours,
    unitPrice: calc.unitPrice,
    amount: calc.amount,
    remarks: raw.remarks,
    createdAt,
    updatedAt: cleanText(item?.updatedAt) || createdAt,
    submittedAt: cleanText(item?.submittedAt) || createdAt,
    status,
    approvalNote: cleanMultilineText(item?.approvalNote),
    reviewedAt: cleanText(item?.reviewedAt),
    reviewerId: cleanText(item?.reviewerId),
    reviewerName: cleanText(item?.reviewerName),
    reminderCount: Number.isFinite(Number(item?.reminderCount)) ? Number(item.reminderCount) : 0,
    lastReminderAt: cleanText(item?.lastReminderAt),
    revisionCount: Number.isFinite(Number(item?.revisionCount)) ? Number(item.revisionCount) : 0,
  };
}

function persistStore() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (_) {}
}

function createInitialStore() {
  const courseTypes = DEFAULT_COURSE_TYPES.map((item) => ({ ...item }));
  const courseMap = Object.fromEntries(courseTypes.map((item) => [item.id, item]));
  const users = [
    { id: "admin-001", role: "admin", name: "教务管理员", username: "admin", email: "admin@demo.edu", password: "Demo123!", department: "教务处", employeeNo: "A2026001", createdAt: "2026-03-27T08:00:00.000Z", updatedAt: "2026-03-27T08:00:00.000Z", approvalStatus: "approved", approvedAt: "2026-03-27T08:00:00.000Z", approvedBy: "system", source: "seed" },
    { id: "teacher-001", role: "teacher", name: "张晨", username: "zhang.teacher", email: "zhang@demo.edu", password: "Demo123!", department: "计算机学院", employeeNo: "T2026001", createdAt: "2026-03-27T08:03:00.000Z", updatedAt: "2026-03-27T08:03:00.000Z", approvalStatus: "approved", approvedAt: "2026-03-27T08:03:00.000Z", approvedBy: "admin-001", source: "seed" },
    { id: "teacher-002", role: "teacher", name: "李敏", username: "li.teacher", email: "li@demo.edu", password: "Demo123!", department: "人工智能学院", employeeNo: "T2026002", createdAt: "2026-03-27T08:06:00.000Z", updatedAt: "2026-03-27T08:06:00.000Z", approvalStatus: "approved", approvedAt: "2026-03-27T08:06:00.000Z", approvedBy: "admin-001", source: "seed" },
    { id: "teacher-003", role: "teacher", name: "赵宁", username: "zhao.teacher", email: "zhao@demo.edu", password: "Demo123!", department: "信息工程学院", employeeNo: "T2026003", createdAt: "2026-03-28T02:20:00.000Z", updatedAt: "2026-03-28T02:20:00.000Z", approvalStatus: "pending", approvedAt: "", approvedBy: "", source: "seed" },
  ];

  const claims = [
    seedClaim({ id: "claim-1001", teacherId: "teacher-001", teacherName: "张晨", employeeNo: "T2026001", department: "计算机学院", semester: "2025-2026-2", courseType: "required", courseName: "数据结构", courseCode: "CS201", className: "2024级软件工程1班", studentCount: 68, weeks: 16, weeklyHours: 4, extraHours: 2, adjustmentCoef: 1, remarks: "包含答疑和实验辅导课时。", createdAt: "2026-03-10T01:30:00.000Z", submittedAt: "2026-03-10T01:30:00.000Z", status: "approved", approvalNote: "核对教学任务无误，按当前规则审批通过。", reviewedAt: "2026-03-11T02:10:00.000Z", reviewerId: "admin-001", reviewerName: "教务管理员" }, courseMap),
    seedClaim({ id: "claim-1002", teacherId: "teacher-001", teacherName: "张晨", employeeNo: "T2026001", department: "计算机学院", semester: "2025-2026-2", courseType: "lab", courseName: "程序设计实验", courseCode: "CS210L", className: "2024级计算机科学2班", studentCount: 42, weeks: 12, weeklyHours: 2, extraHours: 4, adjustmentCoef: 1.05, remarks: "包含实验准备和分组指导。", createdAt: "2026-03-16T08:20:00.000Z", submittedAt: "2026-03-16T08:20:00.000Z", status: "pending", approvalNote: "", reviewedAt: "", reviewerId: "", reviewerName: "" }, courseMap),
    seedClaim({ id: "claim-1003", teacherId: "teacher-002", teacherName: "李敏", employeeNo: "T2026002", department: "人工智能学院", semester: "2025-2026-2", courseType: "practice", courseName: "机器学习课程设计", courseCode: "AI309P", className: "2023级人工智能1班", studentCount: 84, weeks: 8, weeklyHours: 4, extraHours: 6, adjustmentCoef: 1.1, remarks: "包含项目评审和阶段答辩。", createdAt: "2026-03-18T03:45:00.000Z", submittedAt: "2026-03-18T03:45:00.000Z", status: "returned", approvalNote: "请补充分组说明和额外课时依据后重新提交。", reviewedAt: "2026-03-19T05:00:00.000Z", reviewerId: "admin-001", reviewerName: "教务管理员" }, courseMap),
  ];

  return {
    version: 4,
    courseTypes,
    users,
    claims,
    session: null,
    loginSecurity: {},
    drafts: { teacherClaims: {} },
    activity: [
      { id: "log-1001", actorName: "系统", actorRole: "system", message: "已载入默认演示数据和账号。", createdAt: "2026-03-27T08:00:00.000Z" },
      { id: "log-1002", actorName: "教务管理员", actorRole: "admin", message: "审批通过了《数据结构》2024级软件工程1班的课时申报。", createdAt: "2026-03-11T02:10:00.000Z" },
      { id: "log-1003", actorName: "教务管理员", actorRole: "admin", message: "退回了《机器学习课程设计》申报，并要求补充额外课时依据。", createdAt: "2026-03-19T05:00:00.000Z" },
    ],
  };
}

function seedClaim(values, courseMap) {
  const calc = calculateClaim(values, courseMap);
  return {
    id: values.id,
    teacherId: values.teacherId,
    teacherName: values.teacherName,
    employeeNo: values.employeeNo,
    department: values.department,
    semester: values.semester,
    courseType: calc.courseType,
    courseName: values.courseName,
    courseCode: values.courseCode,
    className: values.className,
    studentCount: calc.studentCount,
    weeks: calc.weeks,
    weeklyHours: calc.weeklyHours,
    extraHours: calc.extraHours,
    adjustmentCoef: calc.adjustmentCoef,
    baseHours: calc.baseHours,
    typeCoef: calc.typeCoef,
    sizeCoef: calc.sizeCoef,
    sizeBand: calc.sizeBand,
    settledHours: calc.settledHours,
    unitPrice: calc.unitPrice,
    amount: calc.amount,
    remarks: values.remarks || "",
    createdAt: values.createdAt,
    updatedAt: values.submittedAt,
    submittedAt: values.submittedAt,
    status: values.status,
    approvalNote: values.approvalNote || "",
    reviewedAt: values.reviewedAt || "",
    reviewerId: values.reviewerId || "",
    reviewerName: values.reviewerName || "",
    reminderCount: Number.isFinite(Number(values.reminderCount)) ? Number(values.reminderCount) : 0,
    lastReminderAt: values.lastReminderAt || "",
    revisionCount: Number.isFinite(Number(values.revisionCount)) ? Number(values.revisionCount) : 0,
  };
}

function getClaims() {
  if (!Array.isArray(store.claims)) store.claims = [];
  return store.claims;
}

function setClaims(nextClaims) {
  store.claims = nextClaims;
  persistStore();
}

function getCourseTypes() {
  if (!Array.isArray(store.courseTypes) || !store.courseTypes.length) {
    store.courseTypes = DEFAULT_COURSE_TYPES.map((item) => ({ ...item }));
  }
  return store.courseTypes;
}

function setCourseTypes(nextCourseTypes) {
  store.courseTypes = nextCourseTypes;
  persistStore();
}

function getCourseMap() {
  return Object.fromEntries(getCourseTypes().map((item) => [item.id, item]));
}

function findCourseType(typeId, courseMap = getCourseMap()) {
  const list = Object.values(courseMap);
  return courseMap[typeId] || list[0] || DEFAULT_COURSE_TYPES[0];
}

function getTeacherApprovalList() {
  return store.users
    .filter((item) => item.role === "teacher")
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function isTeacherApproved(user) {
  if (!user || user.role !== "teacher") return true;
  return String(user.approvalStatus || "approved") === "approved";
}

function accountStatusLabel(status) {
  return ACCOUNT_STATUS_META[status]?.label || "未知状态";
}

function statusLabel(status) {
  return STATUS_META[status]?.label || "未知状态";
}

function courseLabel(type) {
  return getCourseMap()[type]?.label || "未知课程类型";
}

function findClaim(id) {
  return getClaims().find((item) => item.id === id) || null;
}

function getCurrentUser() {
  if (!store.session?.userId) return null;
  return store.users.find((item) => item.id === store.session.userId) || null;
}

function getClaimDefaults(item, userId) {
  if (item) {
    return {
      semester: item.semester,
      courseType: item.courseType,
      courseName: item.courseName,
      courseCode: item.courseCode,
      className: item.className,
      studentCount: item.studentCount,
      weeks: item.weeks,
      weeklyHours: item.weeklyHours,
      extraHours: item.extraHours,
      adjustmentCoef: item.adjustmentCoef,
      remarks: item.remarks,
    };
  }

  const draft = getTeacherClaimDraft(userId);
  if (draft) {
    return {
      semester: draft.semester || guessCurrentSemester(),
      courseType: draft.courseType || getCourseTypes()[0]?.id || "required",
      courseName: draft.courseName || "",
      courseCode: draft.courseCode || "",
      className: draft.className || "",
      studentCount: Number.isFinite(Number(draft.studentCount)) ? Number(draft.studentCount) : 40,
      weeks: Number.isFinite(Number(draft.weeks)) ? Number(draft.weeks) : 16,
      weeklyHours: Number.isFinite(Number(draft.weeklyHours)) ? Number(draft.weeklyHours) : 2,
      extraHours: Number.isFinite(Number(draft.extraHours)) ? Number(draft.extraHours) : 0,
      adjustmentCoef: Number.isFinite(Number(draft.adjustmentCoef)) ? Number(draft.adjustmentCoef) : 1,
      remarks: draft.remarks || "",
    };
  }

  return {
    semester: guessCurrentSemester(),
    courseType: getCourseTypes()[0]?.id || "required",
    courseName: "",
    courseCode: "",
    className: "",
    studentCount: 40,
    weeks: 16,
    weeklyHours: 2,
    extraHours: 0,
    adjustmentCoef: 1,
    remarks: "",
  };
}

function canEditClaim(item) {
  return item.status === "pending" || item.status === "returned";
}

function resolveSizeRule(studentCount) {
  return SIZE_RULES.find((rule) => studentCount >= rule.min && studentCount <= rule.max) || SIZE_RULES[0];
}

function buildSemesterOptions() {
  const year = new Date().getFullYear();
  return [`${year - 1}-${year}-1`, `${year - 1}-${year}-2`, `${year}-${year + 1}-1`, `${year}-${year + 1}-2`];
}

function guessCurrentSemester() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month >= 8 ? `${year}-${year + 1}-1` : `${year - 1}-${year}-2`;
}

function resolveViewName(route) {
  if (route === "/teacher") return "teacher-dashboard";
  if (route === "/admin") return "admin-dashboard";
  if (route === "/teacher-login" || route === "/register/teacher") return "teacher-auth";
  if (route === "/admin-login" || route === "/register/admin") return "admin-auth";
  return "home";
}

function resolveRouteGuard(route, user) {
  if (route === "/teacher" && (!user || user.role !== "teacher" || !isTeacherApproved(user))) return "/teacher-login";
  if (route === "/admin" && (!user || user.role !== "admin")) return "/admin-login";
  if ((route === "/teacher-login" || route === "/register/teacher") && user?.role === "teacher" && isTeacherApproved(user)) return "/teacher";
  if ((route === "/admin-login" || route === "/register/admin") && user?.role === "admin") return "/admin";
  return "";
}

function getRoute() {
  const raw = window.location.hash.replace(/^#/, "").trim();
  return raw || "/";
}

function navigate(route) {
  window.location.hash = route;
}

function setNotice(message, type = "info", options = {}) {
  ui.notice = { message, type };
  if (ui.noticeTimer) window.clearTimeout(ui.noticeTimer);
  renderNotice();

  const duration = options.duration ?? (type === "error" ? 5200 : 3400);
  if (duration > 0) {
    ui.noticeTimer = window.setTimeout(() => {
      ui.notice = null;
      renderNotice();
    }, duration);
  }
}

function clearNotice() {
  ui.notice = null;
  if (ui.noticeTimer) {
    window.clearTimeout(ui.noticeTimer);
    ui.noticeTimer = null;
  }
  renderNotice();
}

function setAuthFeedback(role, type, message) {
  ui.authFeedback[role] = { type, message };
  syncAuthFeedback(role);
}

function clearAuthFeedback(role) {
  ui.authFeedback[role] = null;
  syncAuthFeedback(role);
}

function defaultReviewNote(status) {
  return status === "approved" ? "核对教学任务无误，同意按当前规则审批通过。" : "请根据反馈补充依据并修改后重新提交。";
}

function renderSelectOptions(values, selected, labelMap = {}) {
  return values
    .map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(labelMap[value] || value)}</option>`)
    .join("");
}

function renderCourseTypeOptions(selected) {
  return getCourseTypes().map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.label)} · 系数 ${formatPlain(item.coef)}</option>`).join("");
}

function renderStatusOptions(selected) {
  return [
    { value: "all", label: "全部状态" },
    { value: "pending", label: "待审批" },
    { value: "approved", label: "已通过" },
    { value: "returned", label: "已退回" },
  ]
    .map((item) => `<option value="${item.value}" ${item.value === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("");
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-6)}`;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanMultilineText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizeCompare(value) {
  return cleanText(value).toLowerCase();
}

function toPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function toNonNegativeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatPlain(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "0.00";
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "0.00";
}

function formatCurrency(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mi}:${ss}`;
}

function formatDateForFile(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isStrongEnoughPassword(password) {
  const text = String(password || "");
  return text.length >= 8 && /[a-zA-Z]/.test(text) && /\d/.test(text);
}

function actorRoleLabel(role) {
  if (role === "admin") return "管理员";
  if (role === "teacher") return "教师";
  return "系统";
}

function recordActivity(actor, message) {
  const next = {
    id: createId("log"),
    actorName: actor?.name || "系统",
    actorRole: actor?.role || "system",
    message,
    createdAt: new Date().toISOString(),
  };

  store.activity = [next, ...(Array.isArray(store.activity) ? store.activity : [])].slice(0, 40);
  persistStore();
}

function clearSession() {
  store.session = null;
  persistStore();
}

function resetUiState() {
  ui.teacherEditId = null;
  ui.adminFilters = { ...DEFAULT_FILTERS };
  ui.selectedIds.clear();
  ui.reviewId = null;
  ui.reviewNote = "";
  ui.authFeedback.teacher = null;
  ui.authFeedback.admin = null;
  ui.teacherDraftTouchedAt = "";
}

function pruneSelectedIds() {
  const validIds = new Set(getClaims().map((item) => item.id));
  Array.from(ui.selectedIds).forEach((id) => {
    if (!validIds.has(id)) ui.selectedIds.delete(id);
  });
}

function saveTeacherClaimDraft(userId, draft) {
  if (!userId) return;
  if (!store.drafts || typeof store.drafts !== "object") store.drafts = { teacherClaims: {} };
  if (!store.drafts.teacherClaims || typeof store.drafts.teacherClaims !== "object") store.drafts.teacherClaims = {};
  store.drafts.teacherClaims[userId] = draft;
  ui.teacherDraftTouchedAt = new Date().toISOString();
  persistStore();
  syncDraftStatus();
}

function clearTeacherClaimDraft(userId) {
  if (!userId || !store.drafts?.teacherClaims?.[userId]) return;
  delete store.drafts.teacherClaims[userId];
  ui.teacherDraftTouchedAt = "";
  persistStore();
  syncDraftStatus();
}

function getTeacherClaimDraft(userId) {
  return store.drafts?.teacherClaims?.[userId] || null;
}

function makeLoginKey(role, username) {
  return `${role}:${String(username || "").trim().toLowerCase()}`;
}

function getLoginSecurityState(role, username) {
  const key = makeLoginKey(role, username);
  const record = store.loginSecurity?.[key];

  if (!record) {
    return { locked: false, attemptsLeft: LOGIN_POLICY.maxAttempts, lockedUntil: "" };
  }

  const lockedUntil = cleanText(record.lockedUntil);
  const lockedUntilMs = Date.parse(lockedUntil);

  if (lockedUntil && Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now()) {
    return { locked: true, attemptsLeft: 0, lockedUntil, remainingMs: lockedUntilMs - Date.now() };
  }

  if (lockedUntil && Number.isFinite(lockedUntilMs) && lockedUntilMs <= Date.now()) {
    delete store.loginSecurity[key];
    persistStore();
    return { locked: false, attemptsLeft: LOGIN_POLICY.maxAttempts, lockedUntil: "" };
  }

  const failedCount = Number.isFinite(Number(record.failedCount)) ? Number(record.failedCount) : 0;
  return { locked: false, attemptsLeft: Math.max(0, LOGIN_POLICY.maxAttempts - failedCount), lockedUntil: "" };
}

function registerFailedLogin(role, username) {
  const key = makeLoginKey(role, username);
  const current = store.loginSecurity?.[key] || { failedCount: 0, lockedUntil: "" };
  const failedCount = (Number(current.failedCount) || 0) + 1;
  const next = {
    failedCount,
    lockedUntil: "",
    lastFailedAt: new Date().toISOString(),
  };

  if (failedCount >= LOGIN_POLICY.maxAttempts) {
    next.failedCount = LOGIN_POLICY.maxAttempts;
    next.lockedUntil = new Date(Date.now() + LOGIN_POLICY.lockMinutes * 60 * 1000).toISOString();
  }

  if (!store.loginSecurity || typeof store.loginSecurity !== "object") {
    store.loginSecurity = {};
  }
  store.loginSecurity[key] = next;
  persistStore();
  return getLoginSecurityState(role, username);
}

function clearLoginSecurity(role, username) {
  const key = makeLoginKey(role, username);
  if (store.loginSecurity?.[key]) {
    delete store.loginSecurity[key];
    persistStore();
  }
}
