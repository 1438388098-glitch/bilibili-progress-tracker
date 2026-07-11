# B站网课进度追踪器 v2 — 设计文档

> 2026-07-06 | Chrome Extension MV3 | 独立仪表盘窗口

---

## 1. 需求映射

| 维度 | 决策 |
|------|------|
| 形态 | `chrome.windows.create({ type: 'popup' })` 独立浮动窗口 |
| 交互 | 点扩展图标打开/关闭 |
| 布局 | 多区域：概览卡片 + 课程列表 + 功能按钮 |
| 窗口 | 首次 1000×700，自适应，记忆位置尺寸 |
| 课程导入 | **「识别当前页面」按钮**一键检测 B 站合集/视频 |
| 自动追踪 | content-script 持续监听播放进度 |
| 数据通信 | Service Worker 中转 + `chrome.runtime.connect` 长连接推送 |
| 统计 | 今日时长 + 连续打卡，无趋势图 |
| 权限 | 新增 `scripting` + `tabs`（用于注入识别脚本） |

---

## 2. 架构

```
┌─────────────────────────────────────────────────────────┐
│                  Chrome Extension MV3                    │
│                                                          │
│  ┌────────────────────┐      ┌──────────────────────┐   │
│  │   content-script   │      │   dashboard.html      │   │
│  │   (B站标签页)       │      │   (独立窗口)           │   │
│  │                    │      │                       │   │
│  │  • 播放监听        │      │  • 概览统计卡片        │   │
│  │  • 进度轮询        │      │  • 课程列表+展开视频   │   │
│  │  • 页面识别响应    │      │  • 「识别当前页面」按钮 │   │
│  │   (被动注入)       │      │  • 设置/导入导出       │   │
│  └────────┬───────────┘      └───────────┬───────────┘   │
│           │ chrome.runtime                 │              │
│           ▼                               ▼              │
│  ┌──────────────────────────────────────────────────┐    │
│  │              Service Worker (background)          │    │
│  │                                                   │    │
│  │  • action.onClicked → 打开/关闭仪表盘窗口         │    │
│  │  • 消息路由 (14 种) + 长连接推送                  │    │
│  │  • IDENTIFY_ACTIVE_TAB → 查活跃标签页 → 注入识别  │    │
│  │  • 数据 I/O → IndexedDB                          │    │
│  └──────────────────────┬───────────────────────────┘    │
│                         ▼                                │
│  ┌──────────────────────────────────────────────────┐    │
│  │               IndexedDB (本地)                    │    │
│  │    courses / videos / daily_stats / settings      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**关键路径：识别当前页面**

```
用户点「识别」→ dashboard.js 发 IDENTIFY_ACTIVE_TAB → SW
→ chrome.tabs.query({ active, url: '*.bilibili.com/*' })
→ chrome.tabs.sendMessage(tabId, { type: 'IDENTIFY_PAGE' })
→ content.js 读取 __INITIAL_STATE__ → 返回 { type, title, videos }
→ SW 收到数据 → SYNC_COLLECTION / 创建课程 → 推送到 dashboard
```

---

## 3. 文件结构

```
bilibili-progress-tracker/
├── manifest.json          # MV3 (无 default_popup)
├── icons/                 # 扩展图标
├── src/
│   ├── background.js      # SW: 窗口管理 + 消息路由 + 识别注入
│   ├── content.js         # 页面注入: 播放监听 + 识别响应
│   ├── dashboard/
│   │   ├── dashboard.html # 独立窗口 HTML
│   │   ├── dashboard.css  # 多区域样式
│   │   └── dashboard.js   # 交互逻辑 + 长连接通信
│   └── lib/
│       ├── constants.js
│       ├── db.js
│       ├── tracker.js
│       ├── stats.js
│       └── export.js
├── scripts/               # 工具脚本
├── DESIGN.md              # v1 设计文档
├── DESIGN-v2.md
└── README.md
```

---

## 4. 仪表盘窗口布局

```
┌──────────────────────────────────────────────────────────┐
│  █  B站进度追踪          [🔍 识别当前页面]  [➕ 新建]  ⚙ │ ← 顶栏
├──────┬───────┬───────────────────────────────────────────┤
│ 今日 │ 今日  │                                            │
│ 12m  │ 完成  │  当前正在看                                  │
│ ⏱学习│ ✅1/3  │  「数据结构 - P3 栈与队列」  ██░░█ 67%     │
│      │       │  断点: 12:35 / 18:00                       │
├──────┴───────┴───────────────────────────────────────────┤
│  搜索/筛选 ─────────────────────── [排序 ▼]              │
│                                                           │
│  📚 合集 · 数据结构与算法     ████████░░ 85% (17/20)      │
│   上次: 2026-07-06 14:23                                 │
│  ┌──────────────────────────────────────────────────────┐│
│  │ ○ P1 绪论                           ████████████ 100%││
│  │ ○ P2 线性表                         ████████████ 100%││
│  │ ● P3 栈与队列                       ████████░░░  68%││
│  │ ○ P4 串                             ░░░░░░░░░░░   0%││
│  └──────────────────────────────────────────────────────┘│
│                                                           │
│  📚 合集 · Python基础          ██████░░░░ 62% (5/8)      │
│   上次: 2026-07-05 09:10                                 │
│  [点击展开]                                               │
├──────────────────────────────────────────────────────────┤
│  共 2 门课程 | 连续打卡 🔥 3 天 | 最长 7 天              │
└──────────────────────────────────────────────────────────┘
```

**尺寸：** `width: 1000px, height: 700px`（初始），自适应缩放，`type: 'popup'`

---

## 5. 数据模型 (IndexedDB)

与 v1 相同，4 个 ObjectStore。唯一改动：`courses.collectionId` 索引去掉 `{ unique: true }`。

---

## 6. 消息协议

### 新增消息类型

| 消息 | 方向 | 说明 |
|------|------|------|
| `IDENTIFY_ACTIVE_TAB` | dashboard → SW | 请求识别当前 B 站页面 |
| `IDENTIFY_PAGE` | SW → content | 注入脚本指令，要求返回页面数据 |
| `IDENTIFY_RESULT` | content → SW | 返回识别结果（type, title, videos 等） |
| `SW_CONNECT` | dashboard → SW | `chrome.runtime.connect` 长连接建立 |
| `PROGRESS_PUSH` | SW → dashboard | 推送到仪表盘窗口（新进度、新课程自动刷新） |
| `DASHBOARD_OPEN` | SW → content | 通知 content-script 仪表盘已打开（可选） |

### 长连接协议

```js
// dashboard.js - 建立长连接
const port = chrome.runtime.connect({ name: 'dashboard' });
port.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS_PUSH') refreshCourses();
  if (msg.type === 'IDENTIFY_RESULT') handleIdentifyResult(msg.payload);
});
```

### 识别流程消息序列

```
dashboard     SW             content (B站tab)
   │           │                │
   ├─IDENTIFY_ACTIVE_TAB──────►│
   │           │                │
   │           ├─IDENTIFY_PAGE─►│
   │           │                ├─解析__INITIAL_STATE__
   │           │◄─IDENTIFY_RESULT
   │           │                │
   │           ├─SYNC_COLLECTION (自动)
   │           │ 或 CREATE_MANUAL_COURSE
   │           │                │
   │◄─PROGRESS_PUSH (结果推送)   │
   │           │                │
```

---

## 7. Service Worker 窗口管理

```js
let dashboardWindowId = null;

chrome.action.onClicked.addListener(async () => {
  if (dashboardWindowId !== null) {
    // 窗口已存在 → 关闭或激活
    try {
      await chrome.windows.remove(dashboardWindowId);
      dashboardWindowId = null;
    } catch(e) {
      dashboardWindowId = null;
    }
  }
  // 记忆位置从 settings 读取
  const win = await chrome.windows.create({
    url: 'src/dashboard/dashboard.html',
    type: 'popup',
    width: rememberedWidth || 1000,
    height: rememberedHeight || 700,
    left: rememberedLeft,
    top: rememberedTop
  });
  dashboardWindowId = win.id;
});

// 窗口关闭时清除引用
chrome.windows.onRemoved.addListener((id) => {
  if (id === dashboardWindowId) dashboardWindowId = null;
});
```

**记忆位置：** 关闭窗口前 dashboard.js 保存 `window.screenX/Y/outerWidth/Height` 到 `settings`。

---

## 8. 边界情况

| 场景 | 处理 |
|------|------|
| 点图标时窗口已存在 | 关闭窗口（toggle 行为） |
| 窗口被手动关闭 | SW 监听 `windows.onRemoved` 清除引用 |
| 没有 B 站标签页 | 识别按钮灰色禁用，hover 提示"请先打开 B 站页面" |
| B 站标签页打开但非合集页 | 尝试解析单视频数据，弹出对话框询问归属 |
| 识别结果为空（无法解析） | 提示"未识别到课程信息" |
| 网络断开 | content-script 本地缓存，重连后恢复 |
| 多个 B 站标签页 | 始终识别最后一个活跃的 B 站标签页 |
| SW 被回收 | MV3 特性，消息触发重新唤醒，窗口不恢复 |
