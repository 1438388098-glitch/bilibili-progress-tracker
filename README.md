# B站网课进度追踪器

> **English**: A Chrome extension (Manifest V3) that automatically records your Bilibili web-course watching progress, with official collection/playlist recognition and study statistics.
> Tracks playback every 5 seconds (adjustable), supports multi-part (multi-P) videos with per-part progress, an adjustable completion threshold (default 98%), daily study time with streaks, JSON backup / CSV export / JSON import, and a standalone dashboard window.
> **Run**: at `chrome://extensions`, enable Developer mode and load this project folder as an unpacked extension — progress is then tracked automatically while you watch on Bilibili.

自动记录哔哩哔哩（Bilibili）网页版课程观看进度，支持合集识别与学习统计。

## 功能

- 视频播放进度自动记录（每 5 秒轮询，可调）
- B 站官方合集/播放列表自动识别
- 手动创建课程（输入 BV 号列表）
- 多 P 视频支持（每个分 P 独立记录进度）
- 完成判定阈值可调（默认 98%）
- 每日学习时长统计 + 连续打卡
- JSON 备份 / CSV 导出 / JSON 导入恢复
- 独立仪表盘窗口（位置尺寸记忆）

## 安装

1. 下载本项目到本地
2. 打开 Chrome 浏览器，地址栏输入 `chrome://extensions/`
3. 打开右上角 **开发者模式** 开关
4. 点击 **加载已解压的扩展程序**
5. 选择项目根目录 `bilibili-progress-tracker`
6. 完成！打开 B 站即可自动追踪

## 项目结构

```
bilibili-progress-tracker/
├── manifest.json          # Chrome Extension MV3 manifest
├── icons/                 # 扩展图标
├── src/
│   ├── background.js      # Service Worker（数据读写、消息路由）
│   ├── content-patch.js   # 页面注入（document_start，shadow DOM 补丁）
│   ├── content.js         # Content Script（播放监听、页面识别）
│   ├── lib/
│   │   ├── constants.js   # 消息类型常量
│   │   ├── db.js          # IndexedDB 封装
│   │   ├── format.js      # 格式化工具
│   │   ├── tracker.js     # 进度计算
│   │   ├── stats.js       # 统计分析
│   │   └── export.js      # 导入导出
│   └── dashboard/
│       ├── dashboard.html # 仪表盘 HTML
│       ├── dashboard.css  # 样式
│       ├── main.js        # 连接、推送处理、全局工具
│       ├── courses.js     # 课程列表渲染
│       ├── stats.js       # 统计面板
│       └── modals.js      # 弹窗（识别、新建、设置、导入导出）
├── scripts/
│   ├── generate-icons.js  # 图标生成脚本
│   └── check-syntax.js    # 语法检查脚本
├── DESIGN.md              # 设计文档 v1
├── DESIGN-v2.md           # 设计文档 v2
└── README.md
```

## 使用说明

### 自动追踪合集

访问 B 站的合集/播放列表页面（如 `bilibili.com/list/ml123456`），扩展会自动识别并同步视频列表到课程列表中。

### 观看视频

正常播放 B 站视频时，扩展会自动记录播放进度。打开合集列表的视频，进度会关联到对应的课程中。多 P 视频的每个分 P 独立记录。

### 手动创建课程

点击扩展图标打开仪表盘 → "新建"按钮，输入课程名称和 BV 号列表（每行一个），即可创建自定义课程。

### 识别当前页面

在仪表盘点"识别当前页面"按钮，扩展会自动检测当前 B 站标签页：
- 合集页 → 一键导入为课程
- 多 P 视频页 → 每个分 P 作为独立视频导入
- 单视频页 → 可添加到已有课程或创建新课程

### 查看统计

仪表盘顶部显示今日学习时长和连续打卡天数。

### 备份与导出

菜单中可以选择导出全量数据为 JSON 备份，或导出视频列表为 CSV 表格。支持从 JSON 备份文件恢复数据。

## 技术栈

- Chrome Extension Manifest V3
- Service Worker + Content Script + 独立仪表盘窗口
- IndexedDB 本地存储
- chrome.runtime.connect 长连接实时推送
- 无第三方依赖（纯原生 JS）

## License

MIT
