# Liquid Glass · WebGL

把 [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass) 的液态玻璃渲染与整套示例组件移植到 **WebGL2**，一行 CDN 引入即可在网页里使用。

上游是一套 Compose Multiplatform 的玻璃效果库（AGSL/RuntimeShader）。本项目把它的着色器逐式翻译成 GLSL ES 3.00，重写了渲染管线与交互层，做到：**同一个折射模型、同一套组件参数、同一套弹簧手感**。

- 在线演示：<https://silverbullet-liang.github.io/liquid-glass-webgl/demo/>（三页：控件 / 参数实验台 / 锁屏）
- 仓库：<https://github.com/silverbullet-liang/liquid-glass-webgl>
- 体积：42 KB（minified，零依赖）
- 需要 WebGL2（Chrome 90+ / Safari 15+ / Firefox 90+）

```
npm i liquid-glass-webgl
```

## CDN

```html
<!-- UMD：挂到 window.LiquidGlass -->
<script src="https://cdn.jsdelivr.net/gh/silverbullet-liang/liquid-glass-webgl@v1.0.1/dist/liquid-glass.min.js"></script>

<!-- ESM -->
<script type="module">
  import { LiquidGlass } from 'https://cdn.jsdelivr.net/gh/silverbullet-liang/liquid-glass-webgl@v1.0.1/dist/liquid-glass.esm.js';
</script>
```

## 最小示例

```html
<canvas id="stage" style="position:fixed;inset:0;width:100%;height:100%"></canvas>
<script src="https://cdn.jsdelivr.net/gh/silverbullet-liang/liquid-glass-webgl@v1.0.1/dist/liquid-glass.min.js"></script>
<script>
const app = new LiquidGlass('#stage', {
  theme: 'dark',
  // 玻璃采样的是这张背景画布，画什么就折射什么
  paint(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#101a2e');
    g.addColorStop(1, '#2b1f4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },
});

app.button({ x: 24, y: 120, w: 200, label: 'Continue', icon: 'check', onClick: () => {} });
app.toggle({ x: 24, y: 190, selected: true });
app.slider({ x: 24, y: 240, w: 260, value: 0.6, onChange: (v) => console.log(v) });
</script>
```

背景可以是任意 2D 绘制：渐变、图片（`ctx.drawImage`）、视频帧、你自己画的可视化——玻璃会实时折射它们。

## 组件

| 工厂 | 说明 | 主要参数 |
| --- | --- | --- |
| `app.button(o)` | 胶囊玻璃按钮，按下有挤压形变与拖拽阻尼 | `x y w h label icon onClick tint tintA labelColor` |
| `app.slider(o)` | 玻璃滑轨 + 弹性拇指（按下放大 1.5×、色散开启） | `x y w value min max step vertical onChange onInput` |
| `app.toggle(o)` | 开关，拖动/点击均可用 | `x y selected onChange` |
| `app.tabs(o)` | 底部标签栏，选中胶囊弹簧跟随 | `x y w tabs[{icon,label}] index onChange` |
| `app.segmented(o)` | 分段控件 | `x y w items index onChange` |
| `app.card(o)` | 通用玻璃面 | `x y w h radius blur lensH lensA tint tintA paint` |
| `app.dialog(o)` | 全屏模糊遮罩 + 居中玻璃卡 | `title body confirm w h onClose` |
| `app.controlCenter(o)` | 控制中心：竖向滑块、圆形开关、媒体卡 | `x y w brightness volume` |
| `app.scrollContainer(o)` | 可拖拽滚动的玻璃容器 | `x y w h radius blur items rowH` |
| `app.progressiveBlur(o)` | 边缘渐进模糊条（滚动遮罩） | `x y w h dir('top'\|'bottom') strength` |
| `app.lockScreen(o)` | 锁屏时钟玻璃卡 | `x y w h time date` |
| `app.magnifier(o)` | 放大镜（强折射，跟随指针） | `d` |
| `app.toast(o)` | 玻璃提示条 | `text duration` |
| `app.node(o)` | 低层节点，自行组合 | 见下表 |

### 节点属性（`app.node()` / 任何组件返回的对象）

```js
const n = app.node({ x, y, w, h, radius: 28 });   // radius 可以是数字或 [tl,tr,br,bl]
n.blur = 8;          // 背景模糊半径 (px)
n.lensH = 24;        // 折射高度：边缘多深开始弯折
n.lensA = 24;        // 折射强度（像素位移）
n.depth = 1;         // 叠加一层向心的深度法线
n.dispersion = 1;    // 7 抽样色散
n.adaptive = true;   // 自适应亮度：背景亮则玻璃随之提亮
n.saturation = 1.5;  // 背景饱和度（上游 vibrancy）
n.tint = [1,1,1]; n.tintA = 0.05;
n.highlight = { color:[1,1,1], alpha:.5, width:.5, blur:.25, falloff:1, angle:45, ambient:false };
n.shadow    = { color:[0,0,0], alpha:.1, blur:24, ox:0, oy:4 };
n.inner     = { color:[0,0,0], alpha:.15, blur:8, ox:0, oy:8 };
n.fade      = { start:0, end:1, mode:0 };         // 0=顶部渐隐 1=底部渐隐
n.setContent((ctx, w, h) => { /* 文字 / 图标 / 图片 */ });
n.invalidate();                                    // 内容变了就重画
```

## 实现

渲染管线每帧：

1. 背景画布 → 上传为纹理 → 写入累积帧 `rtMain`；
2. 按 z 序遍历节点，每个节点只处理自己的包围盒：
   - 从 `rtMain` 采样，做 **可分离高斯两趟**（半分辨率，同时应用 vibrancy 饱和度 1.5）；
   - 用圆角矩形 SDF 计算折射位移 `circleMap(1 - d/h) * amount`，按 `(p.x·p.y)/(hx·hy)` 做 **7 抽样色散**（权重与上游逐项一致）；
   - 沿 SDF 梯度做 **边缘高光**（Default 用 `|dot|^falloff` 加色，Ambient 取单侧做 alpha 混合）；
   - 外阴影/内阴影用 **高斯覆盖的解析式** `0.5·erfc(d/(σ√2))`，不必再模糊一遍；
   - 把图层贴回 `rtMain`（先拷贝原像素，避免透明边缘打洞）；
3. 累积帧呈现到屏幕。

交互层的弹簧用 Compose `spring(dampingRatio, stiffness)` 的解析解（欠阻尼/临界/过阻尼三式），参数与上游一致：按钮 `0.5/300`、滑块与开关 `1/1000`、位移动画 `0.5/300`。

## 与上游的对应

| 上游 Kotlin | 本项目 |
| --- | --- |
| `RoundedRectRefractionShaderString` | `FS_GLASS` 折射段 |
| `RoundedRectRefractionWithDispersionShaderString` | `FS_GLASS` 7 抽样色散 |
| `DefaultHighlightShaderString` / `AmbientHighlightShaderString` | `FS_GLASS` 高光段 |
| `HighlightStyle.Default/Ambient/Plain` | `highlight.ambient` / `highlight.alpha` |
| `Shadow.Default`(24dp,10%) / `InnerShadow.Default` | `shadow` / `inner` 默认值 |
| `InteractiveHighlight` (0.08 全片 + 0.15 径向光) | `uPress` / `uPressPos` |
| `LiquidButton` / `LiquidSlider` / `LiquidToggle` / `LiquidBottomTabs` | `button` / `slider` / `toggle` / `tabs` |
| `ControlCenter` / `Dialog` / `Magnifier` / `LockScreen` / `ProgressiveBlur` | 同名工厂 |
| `AdaptiveLuminanceGlassContent` | `node.adaptive = true` |

已知差异：

- 上游 `BlendMode.Hue` 上色在 WebGL 里改为普通 alpha 叠加（`tint`/`tintA`），观感一致但更可控；
- 只支持圆角矩形族形状（上游的 `RoundedRectangularShape` 系列），不支持任意 SDF；
- 背景必须是本库绘制的画布，无法直接对 DOM 做 backdrop 采样（浏览器不提供这种能力）。

## 开发

```bash
node build.mjs          # → dist/liquid-glass.js / .esm.js
npx esbuild dist/liquid-glass.js --minify --outfile=dist/liquid-glass.min.js
python3 -m http.server 8080   # 打开 /demo/index.html
```

源码：`src/glsl.js`（着色器）、`src/core.js`（管线）、`src/widgets.js`、`src/extras.js`、`src/anim.js`。

## 鸣谢

- **[Kyant (Kyant0)](https://github.com/Kyant0)** — [AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass) 的作者。本项目的折射/色散/高光/阴影着色器数学、组件规格与动画参数都来自这套 Apache-2.0 库；没有它就没有这个移植。
- Apple 的 Liquid Glass 设计语言，是整件事的起点。
- 所有为 Compose 与 WebGL 生态写文档、踩坑、开源的人。

## 许可

**AGPL-3.0-or-later**（见 `LICENSE`）。

上游 `Kyant0/AndroidLiquidGlass` 为 Apache-2.0，其被使用的部分在本项目中继续遵守 Apache-2.0 的归属要求，详见 `NOTICE`。两份许可兼容：Apache-2.0 代码可以并入 AGPL-3.0 项目。

---

<sub>English: A WebGL2 port of Kyant0's AndroidLiquidGlass — SDF refraction, 7-tap chromatic dispersion, SDF edge highlights and analytic shadows, with the same component specs and spring curves. AGPL-3.0-or-later, with Apache-2.0 attribution preserved (see NOTICE).</sub>
