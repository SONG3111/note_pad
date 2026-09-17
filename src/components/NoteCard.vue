<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relativeTime, formatReminderTime, type NoteWithItems } from "../types";
import { mapCardColor } from "../colors";
import { appLocale } from "../composables/useLocale";
import TodoCheckbox from "./TodoCheckbox.vue";
import { useNotesStore } from "../stores/notes";

const { t } = useI18n();

const props = defineProps<{ note: NoteWithItems; detached?: boolean }>();

const emit = defineEmits<{
  edit: [];
  remove: [];
  togglePin: [];
  toggleItem: [itemId: string, checked: boolean];
  removeItem: [itemId: string];
  /** onSettled(failed):父级建窗流程结束(成功/失败),纸片据此交接或弹回 */
  detach: [grab: DetachGrab, onSettled?: (failed: boolean) => void];
}>();

// ─── 拖出为独立窗口:"从手账上撕下便签"手势 ───
// 胶带(右上角)是锚,全程三段:
// ① 按住 → 胶带被捏住微弹,卡片绕胶带微翘预告(≤3°);
// ② 拖动(≥10px) → 原位折角:折痕从被抓角出发、沿"角 → 胶带锚点"方向扫进
//    (撕裂线向胶带传播),进度 = 拖动在该方向上的投影,拖多深折多深;
//    卡片本体保留胶带一侧,被抓一侧沿折痕镜像折回;
//    折痕越逼近胶带,悬层胶带被拽得越长、绷得越紧,临近极限时高频微颤;
// ③ 折痕触及胶带 → 胶带崩脱,整张纸从折角状态起飞成独立窗口(无需松手);
//    松手早于触及 → 折角展开平复,纸贴回手账。
// 克制原则:折角跟手 1:1 无过渡,卷角 ≤28px。

interface DetachGrab {
  /** 光标在源卡片内的偏移(CSS px) */
  dx: number;
  dy: number;
  /** 触及胶带/松手时刻的光标视口坐标(CSS px),供后端换算物理屏幕坐标 */
  clientX: number;
  clientY: number;
}

type Corner = "tl" | "tr" | "bl" | "br";

const FOLLOW_THRESHOLD = 10;
/** 撕离承诺距离:折痕触及胶带/整卡折尽之外还需拖够这段距离,防垂直轻擦误触 */
const DETACH_COMMIT = 45;
/** 卷角边长上限(px) */
const CURL_MAX = 28;
/** 按住预告角(度) */
const PRESS_LIFT = 3;
/** 胶带锚点距卡片右缘的距离(px,与 .card::before 的 right:24px + 半宽 27px 对应) */
const TAPE_INSET_X = 51;
const reduceMotion =
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 拿起(未跟手) */
const lifted = ref(false);
/** 按住预告:绕胶带微翘的倾角(随按下位置计算,跟手开始后清零) */
const pressTilt = ref<{ rx: number; ry: number } | null>(null);
/** ② 原位折角:折痕垂直于拖动方向、1:1 跟手扫进(斜着拖就斜着折),
 * 卡片本体保留对侧(clip),被抓侧克隆层镜像折回;
 * strain = 折痕逼近胶带的程度,驱动胶带拉扯反馈 */
const fold = ref<null | {
  /** 卡片视口原位(与 ghost 同系) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 卡片本体裁剪(对侧,保留) */
  clip: string;
  /** 角瓣裁剪(被抓侧,折起) */
  flapClip: string;
  /** 角瓣镜像反射(2D 矩阵,折痕为轴) */
  reflect: string;
  corner: Corner;
  /** 拖动方向单位向量(平复动画沿它收回) */
  dir: [number, number];
  /** 拖动距离(px),撕离时卷角尺寸由此衔接 */
  leg: number;
  /** 展开平复过渡 */
  settle: boolean;
}>(null);
const ghost = ref<null | {
  html: string;
  /** 原位(viewport CSS px) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 相对原位的位移 */
  dx: number;
  dy: number;
  /** 被抓角的卷角:角位置与折起边长(px) */
  curlCorner: Corner;
  curlSize: number;
  /** 撕离瞬间胶带崩脱(外翻后随纸片飞走) */
  tapeOff: boolean;
  /** follow = 起飞前的原位占位;back/fly = 带过渡的归位/飞向落点;fade = 交接成功后的淡出 */
  mode: "follow" | "back" | "fly" | "fade";
  /** fly 模式的飞行时长(ms),按飞行距离自适应 */
  dur?: number;
}>(null);

let drag: null | {
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
  pointerId: number;
  rect: { left: number; top: number; width: number; height: number };
  el: HTMLElement;
  /** 手势开始时的内容快照(折角瓣与 ghost 共用,拖拽中内容不会变) */
  html: string;
} = null;

/** 抓取点落在哪个象限,折角/卷角就出现在哪个角 */
function cornerOf(gx: number, gy: number, w: number, h: number): Corner {
  return `${gy > h / 2 ? "b" : "t"}${gx > w / 2 ? "r" : "l"}` as Corner;
}

function cornerPos(corner: Corner, w: number, h: number): [number, number] {
  return corner === "tl" ? [0, 0] : corner === "tr" ? [w, 0] : corner === "bl" ? [0, h] : [w, h];
}

/** 胶带矩形四角(卡片局部坐标,与 .card::before 的 right:24px / top:-7px / 54×15 对应) */
function tapeCorners(w: number): Array<[number, number]> {
  return [
    [w - 78, -7],
    [w - 24, -7],
    [w - 78, 8],
    [w - 24, 8],
  ];
}

/** 矩形 ∩ 半平面 {(x−P)·m ≥ 0};顶点不足 6 个用末点补齐(保证 clip-path 可过渡) */
function clipHalfPlane(w: number, h: number, P: [number, number], m: [number, number]) {
  const rect: Array<[number, number]> = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    const a = rect[i];
    const b = rect[(i + 1) % 4];
    const sa = (a[0] - P[0]) * m[0] + (a[1] - P[1]) * m[1];
    const sb = (b[0] - P[0]) * m[0] + (b[1] - P[1]) * m[1];
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    if (sb >= 0) out.push(b);
  }
  while (out.length > 0 && out.length < 6) out.push(out[out.length - 1]);
  return out;
}

const polygonOf = (pts: Array<[number, number]>) =>
  `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`;

/**
 * ② 折痕数学:折痕 = 被抓角 C 与其镜像像 C+2Δ 连线的垂直平分线——
 * 过指针等效点 P = C+Δ、垂直于拖动方向,1:1 跟手扫进(斜着拖就斜着折),
 * 被抓角以 2 倍速翻折到 C+2Δ。卡片本体保留对侧,被抓侧克隆层沿折痕镜像折回。
 * detach = 折痕线穿过胶带矩形(斜向拖,折痕先到),或折面盖过胶带锚点
 * (横向拖,折面先到——胶带与抓取点等高时的自然拖法),或整卡折尽。
 */
function tearState(corner: Corner, dx: number, dy: number) {
  if (!drag) return { fold: null, detach: false };
  const w = drag.rect.width;
  const h = drag.rect.height;
  const C = cornerPos(corner, w, h);
  const T: [number, number] = [w - TAPE_INSET_X, 0];
  const len = Math.hypot(dx, dy);
  if (len < 0.3) return { fold: null, detach: false };
  const u: [number, number] = [dx / len, dy / len];
  // 只向卡片内侧折:向外拖没有翻折空间,纸不动
  if (u[0] * (w / 2 - C[0]) + u[1] * (h / 2 - C[1]) < 0) return { fold: null, detach: false };
  const P: [number, number] = [C[0] + dx, C[1] + dy];
  const flap = clipHalfPlane(w, h, P, [-u[0], -u[1]]); // 被抓侧(折起)
  const base = clipHalfPlane(w, h, P, u); // 对侧(保留)
  // 胶带锚点在拖动方向上的投影:折进距离 k 过半(k ≥ tT/2)时,
  // 锚点的镜像像翻回卡内——折面已经盖过胶带(横向拖时折面先于折痕抵达)
  const tT = (T[0] - C[0]) * u[0] + (T[1] - C[1]) * u[1];
  const rT: [number, number] = [T[0] - 2 * (tT - len) * u[0], T[1] - 2 * (tT - len) * u[1]];
  const flapCoversTape =
    tT > 0 && 2 * len >= tT && rT[0] >= 0 && rT[0] <= w && rT[1] >= 0 && rT[1] <= h;
  // 折痕线穿过胶带矩形:胶带四角对折痕线的符号距离异号(斜向拖,折痕先到)
  const sd = tapeCorners(w).map(([x, y]) => (x - P[0]) * u[0] + (y - P[1]) * u[1]);
  const touchesTape = Math.min(...sd) <= 0 && Math.max(...sd) >= 0;
  // 整卡折尽:保留侧被折完(所有角都在被抓侧)
  const detach = flapCoversTape || touchesTape || base.length < 3;
  if (flap.length < 3) return { fold: null, detach };
  // 镜像反射矩阵:折痕为轴的反射 x' = x − 2((x−P)·u)u
  const mA = 1 - 2 * u[0] * u[0];
  const mB = -2 * u[0] * u[1];
  const mD = 1 - 2 * u[1] * u[1];
  const mE = P[0] - (mA * P[0] + mB * P[1]);
  const mF = P[1] - (mB * P[0] + mD * P[1]);
  return {
    fold: {
      x: drag.rect.left,
      y: drag.rect.top,
      w,
      h,
      clip: polygonOf(base),
      flapClip: polygonOf(flap),
      reflect: `matrix(${mA.toFixed(4)}, ${mB.toFixed(4)}, ${mB.toFixed(4)}, ${mD.toFixed(4)}, ${mE.toFixed(2)}, ${mF.toFixed(2)})`,
      corner,
      dir: u,
      leg: len,
      settle: false,
    },
    detach,
  };
}

/** ③ 起飞:纸片(ghost)从折角状态生成,卷角 = 折痕腿长(截断至上限)衔接 */
function spawnGhost() {
  if (!drag) return;
  const leg = Math.min(CURL_MAX, fold.value?.leg ?? 0);
  fold.value = null;
  ghost.value = {
    html: drag.html,
    x: drag.rect.left,
    y: drag.rect.top,
    w: drag.rect.width,
    h: drag.rect.height,
    dx: 0,
    dy: 0,
    curlCorner: cornerOf(drag.grabX, drag.grabY, drag.rect.width, drag.rect.height),
    curlSize: leg,
    tapeOff: false,
    mode: "follow",
  };
}

/** 折角展开平复(③ 回弹路径):重算一个近退化折角,顶点数不变可被 CSS 过渡 */
function unfoldSettle() {
  const f = fold.value;
  if (!f || f.settle) return;
  if (reduceMotion) {
    fold.value = null;
    return;
  }
  // 沿原拖动方向把折痕收回到距角 0.35px:多边形/矩阵均塌缩到角,可被 CSS 过渡
  const tiny = tearState(f.corner, f.dir[0] * 0.35, f.dir[1] * 0.35);
  fold.value = tiny.fold ? { ...tiny.fold, settle: true } : null;
  window.setTimeout(() => {
    if (fold.value?.settle) fold.value = null;
  }, 170);
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest("button, input, textarea, label, a")) return;
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  // 指针捕获:拖出主窗口边界后 move/up 仍派发到卡片,松手语义不丢
  try {
    el.setPointerCapture(e.pointerId);
  } catch {}
  // 上一次回弹/平复动画中的纸片直接作废,新手势从干净状态开始
  ghost.value = null;
  fold.value = null;
  drag = {
    startX: e.clientX,
    startY: e.clientY,
    grabX: e.clientX - rect.left,
    grabY: e.clientY - rect.top,
    pointerId: e.pointerId,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    el,
    html: el.innerHTML,
  };
  // ① 按住预告:胶带被捏住,卡片绕右上角胶带微微掀起(≤3°)——指尖压住了纸的一侧
  pressTilt.value = reduceMotion
    ? { rx: 0, ry: 0 }
    : {
        rx: ((e.clientY - rect.top) / rect.height) * PRESS_LIFT,
        ry: ((rect.width - TAPE_INSET_X - (e.clientX - rect.left)) / rect.width) * PRESS_LIFT,
      };
  lifted.value = true;
}

function onPointerMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  const dist = Math.hypot(dx, dy);
  if (dist < FOLLOW_THRESHOLD) return;
  // 拖动全程指针会扫过其他内容,屏蔽文本选择避免"拖出 A 选中 B 的文字"
  document.body.style.userSelect = "none";
  lifted.value = false;
  pressTilt.value = null;
  const corner = cornerOf(drag.grabX, drag.grabY, drag.rect.width, drag.rect.height);
  const { fold: next, detach } = tearState(corner, dx, dy);
  // 向下拉扯(方向足够向下)= 顺着胶带粘着方向把整张纸揭下来:立即撕离,
  // 不必等折痕/折面扫到胶带——向下是"揭",朝胶带折是"撕",两条路都通
  const peelOff = dy >= 0.707 * dist;
  if ((detach || peelOff) && dist >= DETACH_COMMIT) {
    // ③ 折痕/折面扫到胶带,或向下揭纸:整张纸被撕离,起飞成独立窗口(无需等松手)
    spawnGhost();
    const grab: DetachGrab = {
      dx: drag.grabX,
      dy: drag.grabY,
      clientX: e.clientX,
      clientY: e.clientY,
    };
    drag = null;
    document.body.style.userSelect = "";
    void flyToWindow(grab);
    emit("detach", grab, (failed: boolean) => {
      if (failed) springBack();
      else handoffFade();
    });
    return;
  }
  const f = reduceMotion ? null : next;
  if (f) fold.value = f;
  else if (fold.value && !fold.value.settle) fold.value = null;
}

function onPointerUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  // 松手时纸未撕离:折角展开平复,纸贴回手账
  // (须在 drag 置空前调用——平复的重算依赖手势上下文:卡片矩形/内容快照)
  unfoldSettle();
  drag = null;
  lifted.value = false;
  pressTilt.value = null;
  document.body.style.userSelect = "";
}

/** 建窗交接成功:纸片在落点轻轻淡出,与新窗口的淡入交叉溶解,而非瞬间消失 */
function handoffFade() {
  if (!ghost.value) return;
  ghost.value = { ...ghost.value, mode: "fade" };
  window.setTimeout(() => {
    if (ghost.value?.mode === "fade") ghost.value = null;
  }, reduceMotion ? 0 : 150);
}

function onPointerCancel() {
  if (!drag) return;
  // 系统打断手势(等效"没拖到位"):折角展开平复,不建窗
  // (须在 drag 置空前调用——平复的重算依赖手势上下文:卡片矩形/内容快照)
  unfoldSettle();
  drag = null;
  lifted.value = false;
  pressTilt.value = null;
  document.body.style.userSelect = "";
}

function springBack() {
  lifted.value = false;
  pressTilt.value = null;
  document.body.style.userSelect = "";
  if (!ghost.value) return;
  // 建窗失败:纸片弹回原位,占位还原为卡片
  ghost.value = { ...ghost.value, dx: 0, dy: 0, curlSize: 0, tapeOff: false, mode: "back" };
  // 回弹落定后摘除纸片,占位还原为卡片
  window.setTimeout(() => {
    if (ghost.value?.mode === "back") ghost.value = null;
  }, reduceMotion ? 0 : 240);
}

async function flyToWindow(grab: DetachGrab) {
  const g = ghost.value;
  if (!g) return;
  // 目标 = 独立窗口左上角(本窗口 viewport CSS px),与后端 detach_position 同一公式
  try {
    const win = getCurrentWindow();
    const [scale, pos] = await Promise.all([win.scaleFactor(), win.innerPosition()]);
    if (typeof scale !== "number" || !pos) return;
    const gx = Math.min(Math.max(grab.dx, GRAB_MARGIN_X), NOTE_WINDOW_W - GRAB_MARGIN_X);
    const gy = Math.min(Math.max(grab.dy, GRAB_MARGIN_Y), NOTE_WINDOW_H - GRAB_MARGIN_Y);
    const tx = (pos.x + grab.clientX * scale - gx * scale - pos.x) / scale;
    const ty = (pos.y + grab.clientY * scale - gy * scale - pos.y) / scale;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    // 飞行时长按距离自适应:拖 50px 与拖到屏幕另一头不该是同一速度,
    // 近距离轻快、远距离有"抛出去"的行程感,但不拖沓(上限 380ms)
    const dist = Math.hypot(tx - (g.x + g.dx), ty - (g.y + g.dy));
    const dur = reduceMotion ? 0 : Math.round(Math.min(380, Math.max(160, dist * 0.35)));
    // 等两个渲染帧再切 fly:IPC 常在同帧内返回,尺寸变化若与元素插入
    // 合并进同一次样式结算,过渡不会触发——高度会从卡片尺寸瞬跳到窗口尺寸
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    // 期间纸片被换掉(新手势/交接已处理)则不再更新
    if (ghost.value !== g) return;
    // 起飞:胶带崩脱外翻,卷角在飞行中收拢,纸片飞向落点
    ghost.value = { ...g, mode: "fly", dx: tx - g.x, dy: ty - g.y, curlSize: 0, tapeOff: true, w: NOTE_WINDOW_W, h: NOTE_WINDOW_H, dur };
  } catch {
    // 窗口变换不可用:纸片原地等交接,不做飞入
  }
}

const GRAB_MARGIN_X = 24;
const GRAB_MARGIN_Y = 20;
const NOTE_WINDOW_W = 360;
const NOTE_WINDOW_H = 380;

const ghostStyle = computed(() => {
  const g = ghost.value;
  if (!g) return undefined;
  return {
    left: `${g.x}px`,
    top: `${g.y}px`,
    width: `${g.w}px`,
    height: `${g.h}px`,
    transform: `translate(${g.dx}px, ${g.dy}px)`,
    ...(g.dur !== undefined ? { "--fly-dur": `${g.dur}ms` } : {}),
  };
});

/** 按钮路径同样走"纸片飞向落点"链路:卡片原位让位,纸片从按钮处起飞 */
function detachViaButton(e: MouseEvent) {
  const card = (e.currentTarget as HTMLElement).closest(".card") as HTMLElement;
  const rect = card.getBoundingClientRect();
  const grabX = e.clientX - rect.left;
  const grabY = e.clientY - rect.top;
  ghost.value = {
    html: card.innerHTML,
    x: rect.left,
    y: rect.top,
    w: rect.width,
    h: rect.height,
    dx: 0,
    dy: 0,
    curlCorner: cornerOf(grabX, grabY, rect.width, rect.height),
    curlSize: 0,
    tapeOff: false,
    mode: "follow",
  };
  const grab: DetachGrab = {
    dx: grabX,
    dy: grabY,
    clientX: e.clientX,
    clientY: e.clientY,
  };
  void flyToWindow(grab);
  emit("detach", grab, (failed: boolean) => {
    if (failed) springBack();
    else handoffFade();
  });
}


// 展开/收起状态存于 store,切换 tab 不丢失
const notesStore = useNotesStore();
const expanded = computed({
  get: () => notesStore.isExpanded(props.note.id),
  set: (v: boolean) => notesStore.setExpanded(props.note.id, v),
});
const collapsible = computed(() => props.note.items.length > 6);
const visibleItems = computed(() =>
  expanded.value ? props.note.items : props.note.items.slice(0, 6)
);

const doneCount = computed(() => props.note.items.filter((i) => i.checked).length);
const totalCount = computed(() => props.note.items.length);
const progress = computed(() => (totalCount.value === 0 ? 0 : Math.round((doneCount.value / totalCount.value) * 100)));

// 全部完成:待办区轻轻脉动一下,与顶层庆祝动画呼应(编辑器里勾完最后一项时,卡片同样响应)
const allDone = computed(() => totalCount.value >= 2 && doneCount.value === totalCount.value);
const pop = ref(false);
let popTimer: number | undefined;
watch(allDone, (v, was) => {
  if (v && !was) {
    pop.value = true;
    window.clearTimeout(popTimer);
    popTimer = window.setTimeout(() => (pop.value = false), 450);
  }
});
onBeforeUnmount(() => window.clearTimeout(popTimer));
</script>

<template>
  <article
    class="card"
    :class="{ lifted, placeholder: !!ghost, folding: !!fold, 'fold-settle': !!fold?.settle }"
    :style="{
      '--card-color': mapCardColor(note.color),
      // ② 折角:卡片本体沿折痕裁开,保留胶带一侧
      ...(fold ? { clipPath: fold.clip } : {}),
      // ① 按住预告:以胶带为轴微翘,内联样式覆盖 .card.lifted 的位移变换
      ...(lifted && pressTilt
        ? {
            transform: `perspective(700px) rotateX(${pressTilt.rx}deg) rotateY(${pressTilt.ry}deg) translateY(-2px) scale(1.02)`,
            transformOrigin: `calc(100% - ${TAPE_INSET_X}px) 0px`,
          }
        : {}),
    }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <span v-if="detached" class="win-badge" :title="t('noteCard.detachedBadgeTitle')">{{ t("noteCard.detachedBadge") }}</span>
    <div class="card-top">
      <span v-if="note.pinned" class="pin-badge" :title="t('noteCard.pinnedBadge')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7z"/></svg>
      </span>
      <div class="card-actions">
        <button class="icon-btn" :title="t('noteCard.edit')" @click="emit('edit')">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        </button>
        <button class="icon-btn" :title="t('noteCard.detach')" @click="detachViaButton($event)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
        </button>
        <button
          class="icon-btn"
          :class="{ active: note.pinned }"
          :title="note.pinned ? t('noteCard.unpin') : t('noteCard.pin')"
          @click="emit('togglePin')"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7z"/></svg>
        </button>
        <button class="icon-btn danger" :title="t('noteCard.delete')" @click="emit('remove')">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <h3 v-if="note.title" class="title" :title="note.title">{{ note.title }}</h3>
    <p v-if="note.type === 'note' && note.content" class="content">{{ note.content }}</p>

    <div v-if="note.type === 'todo'" class="todo-area" :class="{ pop }">
      <div v-for="item in visibleItems" :key="item.id" class="todo-row">
        <TodoCheckbox :checked="item.checked" @change="emit('toggleItem', item.id, !item.checked)" />
        <span class="todo-text" :class="{ done: item.checked }">{{ item.text }}</span>
        <!-- 提醒角标:只读展示,设置与修改入口在编辑器里 -->
        <span
          v-if="!item.checked && item.remindAt"
          class="todo-bell"
          :title="t('reminder.badgeTitle', { time: formatReminderTime(item.remindAt, appLocale) })"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        </span>
        <button class="row-del" :title="t('noteCard.deleteItem')" @click="emit('removeItem', item.id)">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <button v-if="collapsible" class="collapse-btn" @click="expanded = !expanded">
        <svg class="chev" :class="{ up: expanded }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
        {{ expanded ? t("noteCard.collapse") : t("noteCard.expandAll", { n: note.items.length }) }}
      </button>
      <p v-if="note.items.length === 0" class="more-hint">{{ t("noteCard.emptyTodoHint") }}</p>
      <div v-if="totalCount > 0" class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" :style="{ width: progress + '%' }"></div></div>
        <span class="progress-text">{{ doneCount }}/{{ totalCount }}</span>
      </div>
    </div>

    <footer class="card-footer">{{ relativeTime(note.updatedAt, appLocale) }}</footer>
  </article>

  <!-- ② 折角瓣(纸背,不带字) / ③④ 跟手纸片:均 Teleport 到 body——
       卡片本体的 clip-path 会裁掉一切子元素,逃逸出裁剪上下文才能叠在卡上;
       --card-color 只挂在 .card 上,克隆层须自带,否则背景透明。
       折角瓣双层:外层承载镜像反射与投影(同一元素上 filter 会被 clip-path 裁掉,
       投影须做在裁剪之外才能跟随折面形状),内层承载裁剪;z 高于卡片——
       纸折过去时,原位胶带被折面盖住 -->
  <Teleport to="body">
    <div
      v-if="fold"
      class="fold-wrap"
      :class="{ 'fold-settle': fold.settle }"
      :style="{
        left: `${fold.x}px`,
        top: `${fold.y}px`,
        width: `${fold.w}px`,
        height: `${fold.h}px`,
        transform: fold.reflect,
      }"
    >
      <div
        class="fold-flap"
        :class="{ 'fold-settle': fold.settle }"
        :style="{ clipPath: fold.flapClip, '--card-color': mapCardColor(note.color) }"
      ></div>
    </div>
    <div
      v-if="ghost"
      class="detach-ghost"
      :class="`mode-${ghost.mode}`"
      :style="{ ...ghostStyle, '--card-color': mapCardColor(note.color) }"
    >
      <div class="g-body" v-html="ghost.html"></div>
      <i class="g-tape" :class="{ off: ghost.tapeOff }"></i>
      <i
        v-if="ghost.curlSize > 0.5"
        class="g-curl"
        :class="ghost.curlCorner"
        :style="{ width: `${ghost.curlSize}px`, height: `${ghost.curlSize}px` }"
      ></i>
    </div>
  </Teleport>
</template>

<style scoped>
/* 卡片 = 手账里的一张彩色便签纸:
   暖墨细边 + 微不均匀圆角 + 极淡纸纹 + 柔和暖影, 右上角一段和纸胶带 */
.card {
  background-color: var(--card-color);
  background-image: var(--grain);
  border: 1px solid rgba(122, 99, 68, 0.26);
  border-radius: 12px 15px 12px 16px / 15px 12px 16px 12px;
  padding: 36px 18px 14px;
  box-shadow:
    0 1px 2px rgba(94, 76, 52, 0.06),
    0 5px 14px rgba(94, 76, 52, 0.07);
  transition:
    box-shadow 0.2s var(--ease-out),
    transform 0.2s var(--ease-out),
    border-color 0.2s var(--ease-out);
  position: relative;
}
/* 和纸胶带: 半透明斜纹, hover 时像被轻轻掀起 */
.card::before {
  content: "";
  position: absolute;
  top: -7px;
  right: 24px;
  width: 54px;
  height: 15px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.38) 0 3px, transparent 3px 7px),
    rgba(233, 200, 122, 0.62);
  clip-path: polygon(3% 12%, 100% 0, 97% 88%, 0 100%);
  transform: rotate(-4deg);
  box-shadow: 0 1px 2px rgba(94, 76, 52, 0.12);
  pointer-events: none;
  transition: transform 0.2s var(--ease-out);
}
.card:hover {
  border-color: rgba(122, 99, 68, 0.4);
  box-shadow:
    0 2px 4px rgba(94, 76, 52, 0.08),
    0 10px 22px rgba(94, 76, 52, 0.12);
  transform: translateY(-2px);
}
.card:hover::before {
  transform: rotate(-1.5deg) translateY(-1px);
}
/* 折角期间取消 hover 位移:底卡与固定定位的角瓣/悬层胶带必须严格对位,
   否则折痕接缝错开 2px */
.card.folding {
  transform: none;
  cursor: grabbing;
}
/* ─── 拖出为独立窗口的两段式手势 ─── */
/* ① 按住:轻微浮起,"它好像被我拿起来了"——幅度刻意小到几乎意识不到 */
.card.lifted {
  transform: translateY(-2px) scale(1.02);
  box-shadow:
    0 4px 10px rgba(94, 76, 52, 0.1),
    0 14px 26px rgba(94, 76, 52, 0.14);
  transition-duration: 0.1s;
  z-index: 4;
  cursor: grabbing;
}
/* 胶带被捏住:微弹+微胀,"指尖捻住了胶带头" */
.card.lifted::before {
  transform: rotate(-7deg) translateY(-1px) scale(1.04);
}
/* ② 跟手阶段:原位留下虚线占位,空间认知是"这个东西正在被拿走" */
.card.placeholder {
  border-style: dashed;
  border-color: rgba(122, 99, 68, 0.32);
  opacity: 0.18;
  transform: scale(0.98);
  pointer-events: none;
  transition:
    opacity 0.15s var(--ease-out),
    transform 0.15s var(--ease-out),
    border-color 0.15s var(--ease-out);
}

.card-top {
  position: absolute;
  top: 10px;
  right: 12px;
  display: flex;
  gap: 4px;
}
.pin-badge {
  font-size: 12px;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  padding-top: 3px;
}
.win-badge {
  position: absolute;
  top: 10px;
  left: 14px;
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  padding: 2px 8px;
  border-radius: 999px;
  pointer-events: none;
  letter-spacing: 0.2px;
}
.card:hover .pin-badge {
  display: none;
}
.card-actions {
  display: none;
  gap: 4px;
}
.card:hover .card-actions {
  display: flex;
}
.icon-btn {
  border: none;
  background: color-mix(in srgb, var(--card-color) 60%, var(--surface) 40%);
  border-radius: 8px 10px 8px 11px / 10px 8px 11px 8px;
  width: 27px;
  height: 27px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.75;
  box-shadow: var(--shadow-s);
  transition:
    opacity 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out),
    box-shadow 0.15s var(--ease-out),
    transform 0.1s var(--ease-out);
  display: grid;
  place-items: center;
  padding: 0;
}
.icon-btn:active { transform: scale(0.9); }
.icon-btn:hover {
  opacity: 1;
  background: var(--surface);
  box-shadow: var(--shadow-m);
}
.icon-btn.active {
  box-shadow: inset 0 0 0 2px var(--text-faint);
  opacity: 1;
}
.icon-btn.danger { color: var(--danger); }
.icon-btn.danger:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.title {
  margin: 0 0 6px;
  font-family: var(--font-hand);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.4px;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.content {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.todo-area {
  margin-top: 4px;
}
/* 全部完成:进度条脉动一下,与顶层庆祝动画呼应。
   脉动只做在进度条(纯色块,无文字)上:transform:scale 对含文字区域会造成
   位图缩放式模糊,纯色块没有这个问题;文字保持原生渲染,永远清晰 */
.todo-area.pop .progress-bar {
  animation: nc-progress-pop 0.45s var(--ease-in-out);
}
@keyframes nc-progress-pop {
  0%, 100% { transform: scaleY(1); }
  50% {
    transform: scaleY(1.2);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 45%, transparent);
  }
}
.todo-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
  font-size: 13.5px;
  color: var(--text);
}
.todo-row :deep(.cb-wrap) {
  margin-top: 2px;
}
.todo-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.row-del {
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-s);
  display: grid;
  place-items: center;
  margin-left: auto;
  opacity: 0;
  transition:
    opacity 0.15s var(--ease-out),
    color 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out);
}
.todo-row:hover .row-del {
  opacity: 1;
}
.row-del:hover {
  color: var(--danger);
  background-color: var(--danger-soft);
}
.todo-row .done {
  text-decoration: line-through;
  color: var(--text-faint);
}
/* 提醒角标:小铃铛,悬停显示具体时间 */
.todo-bell {
  flex: none;
  color: var(--accent);
  display: grid;
  place-items: center;
  padding-top: 2px;
  align-self: flex-start;
}
.more-hint {
  font-family: var(--font-hand);
  font-size: 12.5px;
  color: var(--text-faint);
  margin: 4px 0 0;
}

.collapse-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: none;
  background: transparent;
  padding: 2px 0;
  margin-top: 6px;
  font-family: var(--font-hand);
  font-size: 12.5px;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s var(--ease-out);
}
.collapse-btn:hover { color: var(--text-strong); }
.chev {
  width: 12px;
  height: 12px;
  transition: transform 0.18s var(--ease-in-out);
}
.chev.up { transform: rotate(180deg); }

/* 进度线: 手账里的细进度线, 暖陶土填充 */
.progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.progress-bar {
  flex: 1;
  height: 3px;
  background: color-mix(in srgb, var(--card-color) 38%, #b9a685);
  border-radius: 999px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
  transition: width 0.25s var(--ease-out);
}
.progress-text {
  font-family: var(--font-hand);
  font-size: 12px;
  color: var(--text-muted);
  min-width: 30px;
  text-align: right;
}

.card-footer {
  margin-top: 10px;
  font-family: var(--font-hand);
  font-size: 11.5px;
  color: var(--text-faint);
}
</style>

<style scoped>
/* ② 折角瓣(外层):承载镜像反射与投影——投影做在裁剪之外(filter 在父层,
   clip-path 在子层),阴影才能跟随折面的实际形状;z 高于悬层胶带(290 > 285):
   纸折过去时,胶带被折面盖住 */
.fold-wrap {
  position: fixed;
  z-index: 290;
  pointer-events: none;
  margin: 0;
  transform-origin: 0 0;
  filter: drop-shadow(1px 2px 3px rgba(94, 76, 52, 0.2));
  will-change: transform;
}
/* 折角瓣(内层):实色纸背(不带字,比卡面略浅)+ 纸纹 + 边线 */
.fold-flap {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  background-color: color-mix(in srgb, var(--card-color) 86%, #fff);
  background-image: var(--grain);
  border: 1px solid rgba(122, 99, 68, 0.3);
  border-radius: 12px 15px 12px 16px / 15px 12px 16px 12px;
  will-change: clip-path;
}
/* 跟手折角 1:1 无过渡;展开平复(settle)才带缓动,矩阵/多边形顶点数不变可平滑插值 */
.fold-wrap.fold-settle {
  transition: transform 0.16s var(--ease-out);
}
.fold-flap.fold-settle {
  transition: clip-path 0.16s var(--ease-out);
}
/* 悬层胶带已移除:原位胶带(.card::before)保持原样,
   被折面(z 更高)盖住即"纸折过去了" */
/* 卡片本体的裁剪在平复时同样过渡(须完整列出 .card 已有的过渡属性) */
.card.fold-settle {
  transition:
    clip-path 0.16s var(--ease-out),
    box-shadow 0.2s var(--ease-out),
    transform 0.2s var(--ease-out),
    border-color 0.2s var(--ease-out);
}
/* ③ 跟手纸片:克隆卡片本体,悬于一切之上(Teleport 到 body,免受列表裁剪) */
.detach-ghost {
  position: fixed;
  z-index: 300;
  pointer-events: none;
  margin: 0;
  will-change: transform;
}
/* 纸片本体:承载背景/圆角/内容裁剪;胶带与卷角叠在它外面,溢出可见 */
.g-body {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background-color: var(--card-color);
  background-image: var(--grain);
  border: 1px solid rgba(122, 99, 68, 0.26);
  border-radius: 12px 15px 12px 16px / 15px 12px 16px 12px;
  padding: 36px 18px 14px;
  box-shadow:
    0 4px 10px rgba(94, 76, 52, 0.1),
    0 18px 34px rgba(94, 76, 52, 0.18);
  overflow: hidden;
}
/* 和纸胶带:innerHTML 克隆丢不掉这个视觉锚(::before 不被克隆),用独立元素重绘;
   撕下全程它始终贴在纸片右上角,是"绕胶带掀起"的旋转轴心 */
.g-tape {
  position: absolute;
  top: -7px;
  right: 24px;
  width: 54px;
  height: 15px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.38) 0 3px, transparent 3px 7px),
    rgba(233, 200, 122, 0.62);
  clip-path: polygon(3% 12%, 100% 0, 97% 88%, 0 100%);
  transform: rotate(-4deg);
  box-shadow: 0 1px 2px rgba(94, 76, 52, 0.12);
  transition: transform 0.16s var(--ease-out);
  z-index: 2;
}
/* 撕离瞬间:胶带从纸面崩脱,向外翻弹后随纸片一起飞走 */
.g-tape.off {
  transform: rotate(9deg) translate(4px, -3px);
  box-shadow: 0 2px 4px rgba(94, 76, 52, 0.16);
}
/* 卷角:起飞时折痕腿长的残留,渐变三角模拟纸背光影;飞行中带过渡收拢 */
.g-curl {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(
    135deg,
    rgba(94, 76, 52, 0.1),
    color-mix(in srgb, var(--card-color) 72%, #fff) 60%,
    rgba(255, 255, 255, 0.9)
  );
  box-shadow: -2px -2px 5px rgba(94, 76, 52, 0.1);
  transition:
    width 0.18s var(--ease-out),
    height 0.18s var(--ease-out);
}
.g-curl.tl { left: 0; top: 0; clip-path: polygon(0 0, 100% 0, 0 100%); }
.g-curl.tr { right: 0; top: 0; clip-path: polygon(0 0, 100% 0, 100% 100%); }
.g-curl.br { right: 0; bottom: 0; clip-path: polygon(100% 0, 100% 100%, 0 100%); }
.g-curl.bl { left: 0; bottom: 0; clip-path: polygon(0 0, 0 100%, 100% 100%); }
/* follow = 起飞瞬间的原位占位(无过渡);back/fly 才带缓动 */
.detach-ghost.mode-back {
  transition: transform 0.24s var(--ease-spring);
}
/* fly:时长随飞行距离自适应(--fly-dur 由 JS 按距离算出);
   飞行结束后(webview 建窗加载期)进入呼吸态——阴影极轻脉动,
   把"等待新窗口"变成"纸片被指尖按在落点上等待松手"的有意停顿 */
.detach-ghost.mode-fly {
  transition:
    transform var(--fly-dur, 180ms) cubic-bezier(0.22, 1, 0.36, 1),
    width var(--fly-dur, 180ms) cubic-bezier(0.22, 1, 0.36, 1),
    height var(--fly-dur, 180ms) cubic-bezier(0.22, 1, 0.36, 1);
}
@media (prefers-reduced-motion: no-preference) {
  .detach-ghost.mode-fly .g-body {
    animation: ghost-breathe 1.1s var(--ease-in-out) var(--fly-dur, 180ms) infinite;
  }
}
@keyframes ghost-breathe {
  0%, 100% {
    box-shadow:
      0 4px 10px rgba(94, 76, 52, 0.1),
      0 18px 34px rgba(94, 76, 52, 0.18);
  }
  50% {
    box-shadow:
      0 5px 12px rgba(94, 76, 52, 0.11),
      0 22px 40px rgba(94, 76, 52, 0.23);
  }
}
/* fade:交接成功,纸片在落点淡出,与新窗口的淡入交叉溶解 */
.detach-ghost.mode-fade {
  transition: opacity 0.14s var(--ease-out);
  opacity: 0;
}
</style>

<style>
/* 跟手纸片的内文:v-html 克隆不带 scoped 标记,补少量全局排版规则;
   纸片只读展示(拖完即焚),交互元素与角标一并隐藏。
   (折角瓣是实色纸背、不带内容,无需这些规则) */
.detach-ghost .card-actions,
.detach-ghost .row-del,
.detach-ghost .collapse-btn,
.detach-ghost .pin-badge,
.detach-ghost .win-badge,
.detach-ghost .todo-bell,
.detach-ghost .cb-wrap {
  display: none;
}
.detach-ghost .title {
  margin: 0 0 6px;
  font-family: var(--font-hand);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.4px;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detach-ghost .content {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.detach-ghost .todo-area {
  margin-top: 4px;
}
.detach-ghost .todo-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
  font-size: 13.5px;
  color: var(--text);
}
/* 手绘风小方框顶替真复选框:纸片上只需"这是一条待办"的形,不需交互 */
.detach-ghost .todo-row::before {
  content: "";
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  border: 1.5px solid rgba(122, 99, 68, 0.5);
  border-radius: 4px 5px 4px 5px / 5px 4px 5px 4px;
}
.detach-ghost .todo-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.detach-ghost .todo-row .done {
  text-decoration: line-through;
  color: var(--text-faint);
}
.detach-ghost .progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.detach-ghost .progress-bar {
  flex: 1;
  height: 3px;
  background: color-mix(in srgb, var(--card-color) 38%, #b9a685);
  border-radius: 999px;
}
.detach-ghost .progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
}
.detach-ghost .progress-text {
  font-family: var(--font-hand);
  font-size: 12px;
  color: var(--text-muted);
}
.detach-ghost .card-footer {
  margin-top: 10px;
  font-family: var(--font-hand);
  font-size: 11.5px;
  color: var(--text-faint);
}
</style>
