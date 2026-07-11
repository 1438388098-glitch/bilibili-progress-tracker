# Bilibili 网课进度识别器 — 设计文档

> 版本 v1.0 | 2026-07-06 | Chrome Extension MV3

---

## 1. 需求映射表

| 问题编号 | 决策                                     |
| -------- | ---------------------------------------- |
| Q1       | Chrome 浏览器扩展                        |
| Q2       | 视频级 + 课程汇总                        |
| Q3       | 官方合集自动识别 + 手动创建课程 (D)      |
| Q4       | 浏览器本地存储 IndexedDB                 |
| Q5       | 页面加载自动扫描 + 播放轮询 (D)          |
| Q6       | 学习统计：每日时长、连续打卡、趋势图     |
| Q7       | 可自定义完成阈值，默认 98%               |
| Q8       | Popup 弹窗管理面板                       |
| Q9       | JSON 导入导出 + CSV 导出                 |
| Q10      | GitHub 开源 + 手动安装                   |

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                    Chrome Extension MV3                   │
│                                                           │
│  ┌────────────────────┐      ┌───────────────────────┐   │
│  │   content-script   │      │     popup.html/js      │   │
│  │   (B站页面注入)     │◄────►│   (点击扩展图标弹窗)    │   │
│  │                    │ msg  │                        │   │
│  │  • 播放器探针       │      │  • 课程列表 + 进度条    │   │
│  │  • 合集解析器       │      │  • 视频详情 + 完成状态 │   │
│  │  • 进度轮询器       │      │  • 统计图表 (Chart.js) │   │
│  │  • DOM 监听器       │      │  • 导入导出面板        │   │
│  └────────┬───────────┘      │  • 设置面板            │   │
│           │                  └───────────┬───────────┘   │
│           │ chrome.runtime.sendMessage     │              │
│           ▼                               ▼              │
│  ┌──────────────────────────────────────────────────┐    │
│  │              Service Worker (背景)                │    │
│  │                                                   │    │
│  │  • 消息路由    • 数据 I/O    • 统计计算            │    │
│  │  • 打卡判定    • 导出生成    • 初始化/迁移         │    │
│  └──────────────────────┬───────────────────────────┘    │
│                         ▼                                │
│  ┌──────────────────────────────────────────────────┐    │
│  │        IndexedDB (chrome.storage.local 兜底)      │    │
│  │                                                    │    │
│  │  courses / videos / daily_stats / settings         │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

**通信链路：**

1. `content-script` ↔ `service-worker`：通过 `chrome.runtime.sendMessage`（B 站页面内单向或双向）
2. `popup` ↔ `service-worker`：通过 `chrome.runtime.sendMessage`
3. `content-script` ↔ `popup`：**不直接通信**，始终走 SW 中转，避免时序问题

---

## 3. 文件结构

```
bilibili-progress-tracker/
├── manifest.json
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── background.js          # Service Worker
│   ├── content.js             # Content Script（注入 B 站页面）
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   └── lib/
│       ├── db.js              # IndexedDB 封装
│       ├── parser.js          # B 站 DOM/API 解析
│       ├── tracker.js         # 进度记录与判定
│       ├── stats.js           # 统计计算
│       ├── export.js          # JSON/CSV 序列化
│       └── constants.js       # 常量、消息类型枚举
├── tests/                     # 单元测试（后续补）
├── README.md
├── CHANGELOG.md
└── DESIGN.md                  # 本文档
```

---

## 4. 数据模型（IndexedDB）

### 4.1 ObjectStore: `courses`

| 字段               | 类型     | 说明                                        |
| ------------------ | -------- | ------------------------------------------- |
| `id`               | autoInc  | 主键                                        |
| `source`           | string   | `"collection"` 或 `"manual"`               |
| `collectionId`     | number?  | B 站合集 id（source=collection 时有值）     |
| `upId`             | number?  | UP 主 mid                                  |
| `title`            | string   | 课程名称                                    |
| `coverUrl`         | string?  | 封面图 CDN 地址                             |
| `bvidList`         | string[] | 视频 BV 号有序列表（手动课程的核心字段）    |
| `totalVideos`      | number   | 视频总数                                    |
| `completedVideos`  | number   | 已完成视频数，实时计算缓存                   |
| `createdAt`        | number   | Unix 时间戳                                 |
| `updatedAt`        | number   | Unix 时间戳                                 |

**索引：** `source`, `collectionId` (unique), `createdAt`

### 4.2 ObjectStore: `videos`

| 字段              | 类型     | 说明                        |
| ----------------- | -------- | --------------------------- |
| `id`              | autoInc  | 主键                        |
| `courseId`        | number   | 外键 → courses.id          |
| `bvid`            | string   | BV 号（全局唯一）           |
| `aid`             | number   | AV 号（兼容旧链接）         |
| `cid`             | number?  | 分 P cid（多 P 视频用）    |
| `title`           | string   | 视频标题                    |
| `duration`        | number   | 总时长（秒）                |
| `currentTime`     | number   | 当前已播放秒数               |
| `progressPercent` | number   | 播放百分比 0~100            |
| `completed`       | boolean  | 是否完成（≥阈值）            |
| `watchCount`      | number   | 观看次数（用来去重统计）     |
| `lastPlayedAt`    | number   | 上次观看时间戳               |
| `updatedAt`       | number   | Unix 时间戳                  |

**索引：** `courseId`, `bvid` (unique), `completed`, `lastPlayedAt`

### 4.3 ObjectStore: `daily_stats`

| 字段              | 类型     | 说明                          |
| ----------------- | -------- | ----------------------------- |
| `id`              | autoInc  | 主键                          |
| `date`            | string   | YYYY-MM-DD（unique index）    |
| `totalSeconds`    | number   | 当天累计观看秒数               |
| `videoCount`      | number   | 当天观看的不同视频数            |
| `completedCount`  | number   | 当天新完成的视频数              |
| `courseCount`     | number   | 当天有活跃的课程数              |

**索引：** `date` (unique)

### 4.4 ObjectStore: `settings`

| 字段     | 类型   | 说明                                |
| -------- | ------ | ----------------------------------- |
| `key`    | string | 主键，如 `threshold`、`pollInterval` |
| `value`  | any    | JSON-able 值                        |

**默认值：**

| key             | 默认值  | 说明           |
| --------------- | ------- | -------------- |
| `threshold`     | `98`    | 完成阈值 (%)   |
| `pollInterval`  | `5`     | 轮询间隔（秒）  |
| `dbVersion`     | `1`     | 数据库版本号   |

---

## 5. 模块详细设计

### 5.1 content.js — 页面注入逻辑

**注入时机：** `manifest.json` 中 `matches: ["*://*.bilibili.com/*"]`，`run_at: "document_idle"`

**页面类型检测：**

```js
function detectPageType() {
  const url = location.href;
  if (/\/video\/BV\w+/.test(url))       return 'video';      // 视频播放页
  if (/\/list\/ml\d+/.test(url))         return 'collection'; // 合集页
  if (/\/medialist\/play\/ml\d+/.test(url)) return 'collection'; // 新版合集播放
  return 'other';
}
```

**合集解析（collection 页）：**

1. 从 URL 提取 `collectionId`（ml + 数字）
2. 调用 B 站 API `https://api.bilibili.com/x/v3/fav/resource/list?media_id=<mlId>&ps=20&pn=1` 拉取视频列表（有跨域问题，改为 DOM 解析 B 站 pagelet 数据）
3. 若 API 受限，回退为 DOM 解析：抓取 `.video-list` 下的 `.video-item` 提取标题、BV 号、时长
4. 通过 `sendMessage({ type: 'SYNC_COLLECTION', payload })` 发送给 SW

**视频播放页探针（video 页）：**

1. 等待 `<video>` 元素加载（MutationObserver 监听）
2. 监听关键事件：
   - `play` / `pause` — 记录观看区间
   - `ended` — 标记完成
   - `timeupdate` — 节流到 5 秒一次（可配置），记录进度
   - `seeking` / `seeked` — 忽略跳转间隔，防止进度虚高
3. 获取视频元数据：标题、BV 号、当前分 P cid（B 站页面 window.__INITIAL_STATE__）
4. 非活跃 tab 时暂停轮询（`document.visibilitychange`）

**进度汇报格式（发给 SW）：**

```js
{
  type: 'REPORT_PROGRESS',
  payload: {
    bvid: 'BV1xx411c7XH',
    aid: 170001,
    cid: null,
    title: '第1讲：绪论',
    duration: 3600,
    currentTime: 3528.5,
    progressPercent: 98.01,
    timestamp: Date.now()
  }
}
```

**SPA 路由监听：** B 站是 SPA，需用 MutationObserver 监听 URL 变化（`__INITIAL_STATE__` 的 pageType 变化），每次路由切换重新检测页面类型。

### 5.2 background.js — Service Worker

**职责表：**

| 消息类型               | 处理逻辑                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| `REPORT_PROGRESS`      | 存入 videos 表；更新 course 完成数；更新 daily_stats                     |
| `SYNC_COLLECTION`      | 对比已有数据，增量 upsert videos；快照 course 的 bvidList                 |
| `GET_COURSES`          | 返回所有课程（按 updatedAt 降序）                                        |
| `GET_COURSE_DETAIL`    | 返回指定课程 + 该课程所有视频列表                                        |
| `GET_STATS`            | 返回 daily_stats 聚合（近 7/30 天）                                      |
| `GET_STREAK`           | 计算连续打卡天数、最长连续天数                                           |
| `CREATE_MANUAL_COURSE` | 插入手动课程                                                             |
| `ADD_VIDEO_TO_COURSE`  | 向手动课程添加视频                                                       |
| `REMOVE_COURSE`        | 删除课程及其关联所有视频                                                  |
| `GET_SETTINGS`         | 返回 settings 全部键值对                                                  |
| `UPDATE_SETTING`       | 更新单个设置                                                             |
| `EXPORT_JSON`          | 序列化全部数据 → blob URL                                                |
| `IMPORT_JSON`          | 解析 JSON → 覆盖/合并现有数据                                             |
| `EXPORT_CSV`           | 生成视频级 CSV → blob URL                                                |

**数据库初始化：**

```js
async function initDB() {
  const db = await openDB('bilibili-tracker', 1, {
    upgrade(db) {
      // courses store
      const courseStore = db.createObjectStore('courses', { keyPath: 'id', autoIncrement: true });
      courseStore.createIndex('source', 'source');
      courseStore.createIndex('collectionId', 'collectionId', { unique: true });
      courseStore.createIndex('createdAt', 'createdAt');

      // videos store
      const videoStore = db.createObjectStore('videos', { keyPath: 'id', autoIncrement: true });
      videoStore.createIndex('courseId', 'courseId');
      videoStore.createIndex('bvid', 'bvid', { unique: true });
      videoStore.createIndex('completed', 'completed');
      videoStore.createIndex('lastPlayedAt', 'lastPlayedAt');

      // daily_stats store
      const statsStore = db.createObjectStore('daily_stats', { keyPath: 'id', autoIncrement: true });
      statsStore.createIndex('date', 'date', { unique: true });

      // settings store
      db.createObjectStore('settings', { keyPath: 'key' });
    }
  });
  return db;
}
```

**打卡判定算法：**

1. 每日统计更新时，检查今日 `daily_stats.date` 是否存在且有 `totalSeconds > 0`
2. 从今日向前遍历 `daily_stats`，直到遇到 `totalSeconds === 0` 的日期
3. 连续天数 = 有记录的连续天数
4. 最长连续天数 = 全局扫描所有连续段，取最大值

**进度完成判定：**

```js
function isCompleted(progressPercent, threshold) {
  return progressPercent >= threshold; // 默认 threshold = 98
}
```

### 5.3 popup — 面板 UI

**页面结构（popup.html）：**

```
┌─ Header ────────────────────────────────┐
│  📚 B站进度追踪    [⚙️] [📊] [📤]       │
├─ Tab 导航 ──────────────────────────────┤
│  [课程列表]  [统计]  [导入导出]  [设置]  │
├─ 内容区 ────────────────────────────────┤
│  ┌─ 课程卡片 ──────────────────────┐    │
│  │  📖 UP主名称：课程标题           │    │
│  │  ████████████████░░ 85% (17/20) │    │
│  │  ⏱ 上次学习: 2026-07-06 14:23   │    │
│  │  [查看详情]                      │    │
│  └────────────────────────────────┘    │
│  ┌─ 课程卡片 ──────────────────────┐    │
│  │  ...                            │    │
│  └────────────────────────────────┘    │
├─ Footer ────────────────────────────────┤
│  共 5 门课程 | 今日学习 2h 15m          │
└─────────────────────────────────────────┘
```

**Tab 切换行为：**

- **课程列表 Tab（默认）：** 加载时从 SW 获取全部课程，渲染卡片列表
- **统计 Tab：**
  - 今日学习时长（大数字）
  - 连续打卡天数（🔥 x N 天）
  - 近 7 天 / 30 天学习时长趋势图（Chart.js 折线图）
  - 近 7 天完成视频数（柱状图）
- **导入导出 Tab：**
  - 「导出 JSON」按钮 → 下载备份文件
  - 「导出 CSV」按钮 → 下载表格文件
  - 「导入 JSON」→ 文件选择器 + 确认对话框 + 合并校验
- **设置 Tab：**
  - 完成阈值滑块（50%-100%，默认 98%）
  - 轮询间隔输入（3-30 秒，默认 5）

**课程详情子视图：** 点击课程卡片 → 展开视频列表，每行显示标题、进度条、✅/🔴 完成状态

**Popup 尺寸：** `width: 420px, height: 560px`（Chrome 扩展 popup 常见尺寸）

### 5.4 库文件设计

**db.js — IndexedDB 封装：**

```js
// 对外暴露的方法
openDB()                  // 打开/创建数据库
getOne(store, id|index)   // 查询单条
getAll(store, index?)     // 查询全部
put(store, data)          // 插入/更新
bulkPut(store, data[])    // 批量插入
deleteOne(store, id)      // 删除单条
transaction(store, mode)  // 获取事务
```

基于原生 IndexedDB API（不引入 idb 库，减少依赖），用 Promise 封装。

**parser.js — B 站解析：**

```js
parseCollectionFromDOM()       // 从合集页 DOM 解析视频列表
parseVideoMetaFromDOM()        // 从视频页 __INITIAL_STATE__ 解析 BV、aid、cid、标题、时长
parseCollectionFromAPI(mlId)   // (备用) 调 B 站 API 拿合集数据
getBilibiliAPI(apiPath)        // 带 cookie 的 fetch 请求（B 站 API 需 referer）
```

**tracker.js — 进度追踪工具：**

```js
calcProgressPercent(currentTime, duration)  // 百分比计算
isVideoCompleted(percent, threshold)         // 完成判定
mergeWatchIntervals(intervals)               // 合并去重观看区间，计算有效时长
```

**stats.js — 统计：**

```js
getTodayStats()              // 今天的学习数据
getWeeklyStats(days=7)       // 近 N 天数据
getStreak()                  // 连续打卡
calcTotalHours(seconds)      // 秒 → "Xh Ym" 格式化
```

**export.js — 导出：**

```js
exportAsJSON()               // 全量数据 → JSON blob
importFromJSON(file)         // 解析 + 校验 + 合并逻辑
exportAsCSV()                // 视频表 → CSV（UTF-8 BOM）
downloadBlob(blob, filename) // 触发下载
```

**constants.js：**

```js
const MSG_TYPES = {
  REPORT_PROGRESS: 'REPORT_PROGRESS',
  SYNC_COLLECTION: 'SYNC_COLLECTION',
  GET_COURSES: 'GET_COURSES',
  GET_COURSE_DETAIL: 'GET_COURSE_DETAIL',
  // ...
};

const DEFAULTS = {
  THRESHOLD: 98,
  POLL_INTERVAL_SEC: 5,
  DB_NAME: 'bilibili-tracker',
  DB_VERSION: 1,
};

const PAGE_TYPES = {
  VIDEO: 'video',
  COLLECTION: 'collection',
  OTHER: 'other',
};
```

---

## 6. manifest.json 设计

```json
{
  "manifest_version": 3,
  "name": "B站网课进度追踪",
  "version": "1.0.0",
  "description": "自动记录 B 站课程观看进度，支持合集识别与学习统计",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "permissions": [
    "storage",
    "unlimitedStorage"
  ],
  "host_permissions": [
    "*://*.bilibili.com/*",
    "*://api.bilibili.com/*"
  ],
  "background": {
    "service_worker": "src/background.js"
  },
  "content_scripts": [
    {
      "matches": ["*://*.bilibili.com/*"],
      "js": ["src/content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```

**权限说明：**
- `storage` + `unlimitedStorage`：IndexedDB 存储和 chrome.storage.local 兜底
- `host_permissions`：访问 B 站页面和 API
- 无需 `tabs`、`cookies`、`background`（persistent 不支持 MV3）

---

## 7. 数据流关键路径

### 7.1 用户观看视频

```
1. 用户打开 B 站视频页 (bilibili.com/video/BV1xx)
2. content.js 检测页面类型 = 'video'
3. content.js 等待 <video> 加载，监听 play/pause/timeupdate
4. 每 5 秒触发 REPORT_PROGRESS → SW
5. SW 收到消息：
   a. 查找或创建 videos 记录（按 bvid）
   b. 更新 currentTime、progressPercent
   c. 判定 completed (progressPercent >= 98)
   d. 更新对应 course.completedVideos（如有关联课程）
   e. 查找/创建今日 daily_stats，累加观看秒数
6. 用户下次打开 popup → GET_COURSES → 看到最新进度
```

### 7.2 用户浏览合集页

```
1. 用户打开合集页 (bilibili.com/list/ml123456)
2. content.js 检测页面类型 = 'collection'
3. 解析合集标题、视频列表
4. 发送 SYNC_COLLECTION 到 SW
5. SW 对比 courses 表：
   a. 不存在 → 新建 course，批量插入 videos（progress=0）
   b. 已存在 → 增量更新（新增视频追加，删除的视频去标记，不移除已有进度数据）
6. 用户看到 popup 中出现该课程
```

### 7.3 手动创建课程

```
1. popup → "新建课程" 按钮
2. 弹出表单：课程名称、逐条粘贴 BV 号
3. submit → CREATE_MANUAL_COURSE → SW 插入 course(source='manual') + 批量 videos
4. 对于每个 video，SW 异步调用 B 站 API 补全标题和时长
```

---

## 8. 边界情况与容错

| 场景                         | 处理方式                                               |
| ---------------------------- | ------------------------------------------------------ |
| B 站 API 限流/跨域           | DOM 解析兜底；API 失败不阻塞流程                       |
| 视频被删除/下架              | videos 保留历史记录，标记 `status: 'deleted'`          |
| 多 P 视频（同一 BV 多个 cid）| 按 bvid + cid 联合标识，每个分 P 独立跟踪              |
| 用户跳进度条                 | 忽略跨度 >10 秒的跳转，不累加至观看时长                |
| 2 倍速播放                   | 按倍速系数折算有效观看时长                              |
| 同时打开多个 B 站标签页       | 每个 content-script 独立汇报进度，相同 bvid 取最大值   |
| 合集页反复刷新               | 增量合并，已有的 video 不重置进度                       |
| 暂停后长时间不动             | `pause` 事件 + `visibilitychange` 双重保险停止计数     |
| 浏览器关闭/崩溃              | IndexedDB 自动持久化，下次打开恢复                      |
| SW 被回收（MV3 特性）        | 消息唤醒 SW，数据库初始化幂等，reopen 成本极低         |

---

## 9. 自审清单（Self-Review）

### 9.1 占位检查
- [x] 无 TBD / TODO
- [x] 所有接口描述完整

### 9.2 一致性检查
- [x] 消息类型与 SW 处理逻辑一一对应
- [x] IndexedDB 索引设计与查询需求匹配
- [x] 数据流路径闭环（content → SW → popup）
- [x] manifest.json 权限与实际 API 用量一致

### 9.3 范围检查
- [x] 单项目，不需要分解为子项目
- [x] 功能聚焦于进度追踪，没有越界到下载、字幕等无关功能

### 9.4 歧义检查
- [x] "完成" 有明确定义：progressPercent ≥ threshold（默认 98%）
- [x] "学习时长" 有明确定义：有效播放秒数（跳过拖拽 + 倍速系数折扣）
- [x] "打卡" 有明确定义：当天任何 video 的 totalSeconds 累加 > 0
- [x] 合集识别策略明确：官方合集 DOM + API 双通道

---

## 10. 后续迭代预留（非本期范围）

- 跨设备同步（chrome.storage.sync + 云备份）
- B 站课堂（付费课）进度识别
- 番茄钟学习模式
- 通知提醒（长期未学习推送）
- 深色模式适配
- 中英文双语 i18n
