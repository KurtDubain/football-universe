import { type RefObject, useEffect, useRef } from 'react';

/**
 * 全屏浮层的键盘可达性基线：初始焦点、Tab 环绕、Esc 关闭、关闭后焦点归还。
 * 抽成一处是因为抽屉和弹窗需要完全一致的行为，两边各写一份迟早会漏掉其中一条
 * （弹窗此前就只做了 Esc，Tab 会直接跑到浮层背后的页面里）。
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// 默认值必须是模块级常量：内联数组每次渲染都是新引用，会让 effect 反复重绑。
const NO_INERT_SELECTORS: readonly string[] = [];

/**
 * 浮层里第一个匹配选择器的元素未必能接收焦点。比赛直播的折叠播报条就藏着一个
 * `display: none` 的展开按钮，它排在所有可见控件前面：`querySelector` 会选中它，
 * 而浏览器拒绝聚焦隐藏元素，`focus()` 静默失败，焦点于是留在 body 上——Tab 从
 * 浮层背后的页面开始走，陷阱等于没有。Tab 环绕用的是同一份列表，所以必须一起过滤。
 */
function isHidden(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === 'function') {
    return !element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false });
  }
  // 没有 checkVisibility 的环境（jsdom）：沿祖先链看 display / visibility，
  // 因为子元素自身的 computed display 不会因为祖先隐藏而变成 none。
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return false;
}

function focusableItems(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter(element => (
      !element.hasAttribute('disabled')
      && element.getAttribute('aria-hidden') !== 'true'
      && !isHidden(element)
    ));
}

export interface FocusTrapOptions {
  /** 浮层是否打开；关闭时本 hook 不做任何事。 */
  active: boolean;
  /** Esc 回调；不传则不拦截 Esc。 */
  onEscape?: () => void;
  /**
   * 打开期间需要置为 inert 的背景根节点选择器，用来挡住读屏与 Tab 穿透。
   * 只有通过 portal 挂到浮层之外的容器才能传，否则会把浮层自己一起 inert 掉。
   */
  inertSelectors?: readonly string[];
  /** 打开期间锁定 body 滚动，默认开启。 */
  lockScroll?: boolean;
}

export function useFocusTrap<T extends HTMLElement>(
  panelRef: RefObject<T | null>,
  {
    active,
    onEscape,
    inertSelectors = NO_INERT_SELECTORS,
    lockScroll = true,
  }: FocusTrapOptions,
): void {
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const inerted: HTMLElement[] = [];
    for (const selector of inertSelectors) {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || (panel && element.contains(panel))) continue;
      element.setAttribute('inert', '');
      inerted.push(element);
    }

    // 同步聚焦：浮层内容与本次 effect 在同一提交里，测试与真实交互都要求
    // 打开后立刻就能用键盘操作，不能等一帧。
    const first = panel ? focusableItems(panel)[0] : undefined;
    (first ?? panel)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const currentPanel = panelRef.current;
      if (!currentPanel) return;
      const items = focusableItems(currentPanel);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === firstItem || !currentPanel.contains(activeElement))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    // 焦点所在的元素被卸载时，浏览器会把焦点丢回 <body>，陷阱不会自动收回。
    // 比赛直播的转播开场就是一个真实例子：开场 2.2 秒后自动结束，带走当时被
    // 聚焦的「跳过转播开场」按钮，焦点于是落到 body 上，Tab 会从浮层背后的页面
    // 重新开始走——浮层还在，陷阱却已经失效。
    const handleFocusIn = (event: FocusEvent) => {
      const currentPanel = panelRef.current;
      if (!currentPanel) return;
      const target = event.target;
      if (target instanceof Node && currentPanel.contains(target)) return;
      const items = focusableItems(currentPanel);
      (items[0] ?? currentPanel).focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn, true);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      for (const element of inerted) element.removeAttribute('inert');
      previouslyFocused?.focus();
    };
  }, [active, inertSelectors, lockScroll, panelRef]);
}
