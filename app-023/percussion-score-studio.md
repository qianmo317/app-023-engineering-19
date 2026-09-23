# 锣鼓经记谱与节拍试听 · Percussion Score Studio

> 类型：前端 Web 应用（纯前端，无后端）｜难度：★★★｜技术栈：**React 18 + TypeScript 5（strict）+ Vite 5**（手写 CSS；运行时依赖只有 `react` / `react-dom`，无 UI 库、音频库、路由库）

## 1. 一句话简介
把民间锣鼓经的拟音字（咚/哐/才/七…）按整数格时值记成谱面，用 Web Audio 全合成试听，并按 A4 横向出谱打印或导出 PNG。

## 2. 真实场景与痛点
- 锣鼓经靠口传心授，「哐才七 仓」这类拟音字串没有统一谱面，会念的人不一定写得出谱。
- 锣鼓班与戏校排练需要先听到效果：传统做法靠人打一遍，改一个音就要重来。
- 常用曲牌（急急风、四击头、冲头、收头、马腿儿、威风锣鼓·排山）骨架固定，但每次都得重抄一遍。
- 通用打谱软件不认锣鼓经的书写习惯（拟音字 + 字下时值线），做教学与民俗存档都不顺手。

## 3. 目标用户
- 民间锣鼓班、社火与威风锣鼓队的领奏与记谱人。
- 戏曲院校、中小学民乐与音乐教师。
- 民俗/非遗资料整理者：把口传锣鼓段固定成可打印的谱。
- 需要锣鼓段小样试听的编曲与作曲人。

## 4. 核心功能（MVP）
1. **乐器与拟音字体系**：内置 7 件乐器（鼓/大锣/小锣/钹/梆子/板/铃）共 18 个拟音字，同一乐器的不同字代表不同打法（技法 `roll` 滚奏 / `mute` 闷击 / `flam` 双打），数据来自 `src/data/instruments.json`。
2. **键盘录入**：18 条键位映射（字母与 `;`）落字；数字键 `1/2/4/6/8` 切换时值（整拍 4 格 / 半拍 2 格 / ¼ 拍 1 格 / 附点 6 格 / 附点半拍 3 格）；`0` 休止、`T` 连线、`E/R/Y` 滚/闷/双、`Backspace` 清除（`src/pages/Editor.tsx`）。
3. **SVG 网格谱面**：时间 × 乐器二维网格，同一格上的多件乐器垂直对齐（齐奏一眼可见），拟音字下方画时值线，`tie` 时向后跨步延伸（`src/components/ScoreGrid.tsx`、`src/lib/grid.ts`）。
4. **试听**：Web Audio 原生合成，三种配方 `drum` / `metal` / `wood`；lookahead 调度（25ms 轮询、0.12s 预排窗口），BPM 可调 30–240。
5. **曲牌库**：6 个内置骨架一键载入再改；跨小节条目自动切分（前段 `tie` 连打、后段转空步），末尾不足自动补休止（`src/lib/factory.ts`）。
6. **持久化与出谱**：IndexedDB 保存曲目与设置（400ms 防抖自动保存）；打印视图 A4 横向，可切换简谱对照行，`window.print()` 出 PDF，另可导出 2 倍分辨率 PNG。

## 5. 进阶功能
- 独奏/静音按钮（每件乐器一组，当前只作用于播放高亮，见 §11）。
- 段落循环：从选中处起循环 4 小节，循环间无相位漂移。
- 拍号 2/4、3/4、4/4 切换；`+4 小节` / `−末小节` 增删小节。
- 键位重绑：设置页点「改」后按新键，同一键只映射一个字，改动写入 IndexedDB。
- 散板（`freeMeter`）标记与每小节 `tempoNote` 文字标记（数据模型与谱面显示支持，暂无 UI 入口）。
- 简谱对照行、PNG 导出。

## 6. 页面结构
自研 hash 路由，解析在 `src/App.tsx`。

```
#/                    曲目列表：新建空白谱（曲名+拍号+散板）/ 进曲牌库 / 列表（曲名·流派·拍号·小节·BPM·更新时间·打印·删除）
#/score/:id           编辑器：顶栏（标题/流派/拍号/散板/±小节/出谱打印）+ 左乐器面板 + 中时值条与 SVG 谱面 + 下试听控制台
#/score/:id/print     打印视图：A4 横向、简谱对照开关、打印/导出 PDF、导出 PNG（不套顶部导航）
#/library             曲牌库：6 张骨架卡（载入并编辑）+ 拟音字表（音色/基频/衰减）
#/settings            设置：试听（高亮开关、散板伸缩）、键盘映射、乐器音色表
```

## 7. 数据模型
```ts
type Tech = 'roll' | 'mute' | 'flam';
type SynthType = 'drum' | 'metal' | 'wood';

type Instrument = { id: string; name: string; glyphs: string[]; color?: string;
                    synth: { type: SynthType; baseHz: number; decay: number; noise: boolean };
                    techMap?: Record<string, Tech[]> };
type Hit  = { instrumentId: string; velocity: 1 | 2 | 3; glyph?: string; tech?: Tech[] };
type Step = { beats: number; hits: Hit[]; tie?: boolean; rest?: boolean };  // beats = 格数
type Bar  = { index: number; beatsPerBar: number; steps: Step[]; tempoNote?: string };
type Score = { id: string; title: string; style?: string; bpm: number; bars: Bar[];
               instruments: Instrument[]; freeMeter: boolean; updatedAt: number };

type KeyBinding  = { key: string; instrumentId: string; glyphIndex: number };
type AppSettings = { keyMap: KeyBinding[]; durationKeys: Record<string, number>;
                     showHighlight: boolean; currentBeatStretch: number };
type ScheduleEvent = { time: number; barIndex: number; offset: number; instrumentId: string;
                       hit: Hit; glyph: string; durationTicks: number };

const TICKS_PER_BEAT = 4;
const VELOCITY_GAIN: Record<Hit['velocity'], number> = { 1: 0.4, 2: 0.7, 3: 1.0 };
```
IndexedDB 库名 `app023-percussion`，对象仓 `scores`（keyPath `id`，索引 `updatedAt`）与 `settings`（keyPath `id`，固定 `'app'`）。

## 8. 关键算法（关键实现点）
- **整数格时间系统**：全项目唯一时间单位是格，`barTicks(beatsPerBar) = beatsPerBar × 4`；时值表 `DURATIONS` = 整拍 4 / 半拍 2 / ¼ 拍 1 / 附点 6 / 附点半拍 3；切分不单设类型，由格位组合表达（如 1+2+1）。小节不变式：`steps` 各 `beats` 之和 === `barTicks`，由 `isBarFull` 判定（`src/lib/grid.ts`）。
- **落字拆格 `setStepAt`**：目标格与新时值等长时只替换 `hits`；不等长时把原 step 拆成「前空段 + 新 step + 后空段」重建，总格数对不上整小节则返回 `null`（`src/lib/grid.ts`）。
- **拟音字反查与防串乐器**：`buildGlyphMap` 建立「字 → {乐器, 字序号, 技法}」反查表，同一个字属于两个乐器时立即抛错；`resolveKey` 把键盘字符解析成 `Hit`；`validateHitGlyphs` 校验谱面里每个 hit 的字与乐器匹配（`src/lib/glyphs.ts`）。
- **事件展开与调度**：`tickSeconds(bpm) = 60 / bpm / 4`；`computeEvents` 把谱面展开为 `time = startTime + 绝对格 × 每格秒数`，每击独立重算、无累加变量，因此没有累积漂移；`computeLoopEvents` 按段落跨度平移重复。`scheduleEvents` 用 `setInterval(25ms)` 只向 0.12s 窗口填事件，发声时刻交给 `AudioContext` 时间轴精确执行（`src/lib/audio.ts`）。
- **播放前先 `ctx.resume()`**：suspended 状态下 `currentTime` 冻结，排程会挤在 0 附近，所以 `useAudio.play` 先 resume 再排（`src/hooks/useAudio.ts`）。
- **合成音三配方**：鼓 = 低频正弦下滑 + 短噪声；锣/钹 = 带通噪声 + 1 / 1.47 / 2.13 倍三个失谐三角波泛音；木 = 高通噪声 + 三角波 blip；闷击把衰减压到 0.3 倍，双打延后 30ms 补一击，滚奏按 55ms 间隔补击（`src/lib/audio.ts`）。
- **曲牌骨架转换**：`[拟音字数组, 格数][]` 逐条落格，跨小节自动切成「前段 tie 连打 + 后段转空步」，末尾不足补 `rest`，条目用未知拟音字则抛错（`src/lib/factory.ts`）。
- **谱面布局**：小节按 `barsPerRow` 分行，一行系统高 = 小节号 16 + 乐器数 × 行高 + 14 + 简谱行高；时值线长度 = `beats × pxPerTick`，`tieLine` 向后合并连续 tie 的宽度（`src/components/ScoreGrid.tsx`、`src/lib/grid.ts`）。
- **打印字号自适应**：按 A4 横排内容宽 1047px、目标每行最多 16 小节反算 `pxPerTick`，夹在 6–14 之间（`src/pages/Print.tsx`）。
- **自动保存**：谱面变更后 400ms 防抖写 IndexedDB，并回显「已保存 HH:MM」（`src/pages/Editor.tsx`）。

## 9. 交互与视觉要点
- 视觉规范：白底黑字，小节线 `#c0392b`，拍线 `#c9c9c9`，格线 `#eee`，乐器按自身 `color` 上色；选中乐器行底色 `#fff7f2` 且行名变红。
- 谱面状态色：选中列 `rgba(179,0,0,0.14)` 加红框；播放高亮列 `#ffe9a8`；力度点强 = 实心大点、中 = 实心小点、弱 = 空心点。
- 键盘流：字母落字、数字换时值、`←/→` 移格、`↑/↓` 换乐器、`Space` 播放/停止、`+/-` 调速（步长 2，夹在 30–240）；`onKey` 先排除 `INPUT/TEXTAREA/SELECT`，避免与标题输入框抢键。
- 落字后光标按当前时值自动前进，越过小节末尾回绕到下一小节首格。
- 打印用 `@page { size: A4 landscape; margin: 10mm }`，`.no-print` 隐藏工具条，页面底部给「A4 横向、边距 10mm、勾选背景图形」的提示。
- 窄屏（≤760px）编辑区改为纵向，乐器面板横向滚动，隐藏面板标题与提示。

## 10. 验收标准
- 单元测试 58 例全绿：`tests/grid.test.ts` 26 例、`tests/glyphs.test.ts` 18 例、`tests/scheduler.test.ts` 9 例、`tests/storage.test.ts` 5 例。
- 时值换算：整拍 4 / 半拍 2 / ¼ 拍 1 / 附点 6 / 附点半拍 3；4/4 = 16 格、2/4 = 8 格、3/4 = 12 格；不满小节被校验判为错误。
- 调度精度：BPM 120 连续 240 拍，每击时刻与「整数格 × 固定每格秒数」的独立重算结果完全一致，相邻间隔偏差 < 1e-9s（验收线 10ms），末击无累积漂移。
- 齐奏：同一步内鼓、大锣、钹三击的时间集合大小 = 1，完全同刻而非近似。
- 曲牌健壮性：6 个内置骨架经 `scoreFromPattern` 转换后 `validateScore` 与 `validateHitGlyphs` 均返回空数组。
- E2E 13 例：建谱 → 录入 → 齐奏同列（三字中心 x 差 < 1px）→ 播放高亮 → BPM 加减 → 刷新不丢 → 打印视图 4 小节一行且 SVG 宽度 ≤ 1047+64+2 → 改键位后刷新仍生效 → 100 小节谱面滚动 ≥ 50fps。
- Docker 容器内 `curl http://localhost:8103/healthz` 返回 200 与文本 `ok`。

## 11. 边界（刻意不做）
不做录音/采样导入与音频文件上传（全部实时合成）、不做 MIDI 导出、不做多声部总谱与移调、不做账号体系与云同步（数据只在本机 IndexedDB）、不做在线曲牌市场与社区、不做波形编辑——只做「记谱 + 试听 + 出谱」这一条主线。

### 已知实现边界
逐条核对 README 声称与代码实际行为，以下为不一致或未接线的部分：
1. 独奏/静音不改变发声：`audible()` 只被 `visual()` 调用（`src/hooks/useAudio.ts:76`），调度路径 `playRange → scheduleEvents → synthesizeHit` 不读 `soloMute`，点「独」/「默」只影响高亮更新（README §3）。
2. 散板伸缩未接线：`currentBeatStretch` 只在设置页读写（`src/settingsContext.tsx:37`、`src/pages/Settings.tsx:57-68`），`playRange` 调用 `computeLoopEvents` / `computeEvents` 时不传 `stretch`，实际恒为 1（`src/lib/audio.ts:261-264`，README §4.4）。
3. 播放高亮列定位有误：`position.tick` 存的是小节绝对起始格（`src/hooks/useAudio.ts:77-79`），`ScoreGrid` 又把它当小节内偏移使用（`src/components/ScoreGrid.tsx:276`），高亮固定落在小节首拍处，与 README §4.3「不会与声音错位」不符。
4. 散板「不画严格拍格」未实现：`ScoreGrid` 不读取 `freeMeter`，始终按每拍 4 格画拍线与格线（`src/components/ScoreGrid.tsx:247-262`，README §4.4）。
5. 谱面校验函数未接入界面：`validateScore`（`src/lib/grid.ts:148`）与 `validateHitGlyphs`（`src/lib/glyphs.ts:59`）在 `src/` 内无调用方，只有测试引用，README §4.1「`isBarFull` 随处校验」、§4.2「谱面数据校验」在 UI 上无触发点。
6. 设置页「乐器音色」改动无效果：`patchSynth` 只改组件内 `useState`（`src/pages/Settings.tsx:42-46`、`:117-146`），既不写 IndexedDB 也不回写曲目，README §5.4 所称「设置页直接改（仅本浏览器生效）」在这份代码里是无效操作。
7. 交互元素不全是真实控件：乐器行是可点击 `<div>`（`src/pages/Editor.tsx:353-359`）、谱面落字热区是 SVG `<rect>`（`src/components/ScoreGrid.tsx:299-312`），与 README §7「交互元素用真实 `<button>`/`<input>`」有出入。
8. 其余：`changeBeatsPerBar` 末尾 `freeMeter: bpb === 0 ? s.freeMeter : s.freeMeter` 是恒等写法（`src/pages/Editor.tsx:279`，死代码，不影响行为），且改拍号按格偏移搬运 hits，小节变短会丢弃超出的击点；`velocity` 只有类型与渲染、没有编辑入口（`resolveKey` 固定为 2，`src/lib/glyphs.ts:46`）；README 首段指向的仓库根 `README.md`（`../../README.md`）在本批次目录中不存在。

## 12. 容器化与构建（Docker）

交付以容器内运行结果为准，无后端依赖，断网可用。

- **Dockerfile（多阶段）**：`node:20-alpine` 阶段 `npm ci` + `npm run build`，运行阶段 `nginx:1.27-alpine-slim`，只拷 `nginx.conf` 与 `dist/`；`HEALTHCHECK --interval=15s --timeout=3s --retries=5` 执行 `wget -qO- http://localhost/healthz`；镜像目标 < 60MB（`Dockerfile:1`、`:11`、`:14`）。
- **docker-compose.yml**：服务 `app-023`、镜像 `app-023:latest`、容器名 `app-023`，端口 **`8103:80`**，`restart: unless-stopped`。
- **nginx.conf**：`location = /healthz` 返回 200 `ok`；`/assets/` 加 `Cache-Control: public, max-age=31536000, immutable`；`/` 走 SPA 回退 `try_files $uri $uri/ /index.html` 且 `no-cache`；gzip 覆盖 text/css/js/json/svg。
- **.dockerignore**：排除 `node_modules`、`dist`、`e2e`、`tests`、`test-results`、`playwright-report`、`*.wav` 等；**保留** `nginx.conf`（Dockerfile 第二阶段要 COPY）与 `package-lock.json`。

```bash
cd app-023
docker compose up -d --build
curl http://localhost:8103/healthz      # 期望输出 ok
curl -I http://localhost:8103/          # 200 且 Cache-Control: no-cache
docker compose down
```

- 本地自检：`npm run build`（`tsc -b` 类型检查 + `vite build`）零错误；`npm test` 58 例全绿；`E2E_BASE_URL=http://localhost:8103 npx playwright test` 可对容器复跑 13 例 E2E。
- 数据边界：曲目存在浏览器 IndexedDB，按源隔离，dev（5173）、preview（4174）、容器（8103）三处数据互不相通，属预期行为。
