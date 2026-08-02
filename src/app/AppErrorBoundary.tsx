import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SAVE_DIAGNOSTIC_KEY, SAVE_STORAGE_KEY } from '../store/save-schema';

interface AppErrorBoundaryProps {
  children: ReactNode;
  onReload?: () => void;
  onHome?: () => void;
  onReset?: () => void;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export default class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error('未知运行错误'),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app-error-boundary]', error, info.componentStack);
  }

  private reload = (): void => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  private goHome = (): void => {
    if (this.props.onHome) {
      this.props.onHome();
      return;
    }
    window.location.assign('/');
  };

  private resetSave = (): void => {
    if (!window.confirm('确定清除当前存档并重新开始吗？此操作无法撤销。')) return;
    localStorage.removeItem(SAVE_STORAGE_KEY);
    localStorage.removeItem(SAVE_DIAGNOSTIC_KEY);
    if (this.props.onReset) {
      this.props.onReset();
      return;
    }
    window.location.assign('/');
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--surface-page)] px-4 py-10 text-[var(--text-primary)]">
        <section
          role="alert"
          aria-labelledby="app-error-title"
          className="w-full max-w-lg rounded-lg border border-red-900/70 bg-[var(--surface-panel)] p-5 shadow-xl sm:p-6"
        >
          <p className="text-xs font-semibold text-red-400">运行恢复</p>
          <h1 id="app-error-title" className="mt-2 text-xl font-bold">足球宇宙暂时无法继续</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
            页面资源或存档状态出现异常。你可以重新加载、返回主页，或在问题持续时清除当前存档。
          </p>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={this.reload}
              className="min-h-11 rounded bg-[var(--action)] px-4 text-sm font-semibold text-white hover:bg-[var(--action-hover)]"
            >
              重新加载
            </button>
            <button
              type="button"
              onClick={this.goHome}
              className="min-h-11 rounded border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 text-sm font-semibold hover:border-slate-500"
            >
              返回主页
            </button>
          </div>

          <button
            type="button"
            onClick={this.resetSave}
            className="mt-3 min-h-11 w-full px-4 text-sm text-red-400 hover:text-red-300"
          >
            清除存档并重新开始
          </button>

          <details className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-muted)]">
            <summary className="min-h-9 cursor-pointer py-2">错误详情</summary>
            <p className="break-words font-mono leading-5">{this.state.error.message}</p>
          </details>
        </section>
      </main>
    );
  }
}
