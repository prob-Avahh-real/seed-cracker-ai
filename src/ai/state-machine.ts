/**
 * 开壳状态机
 *
 * 定义嗑瓜子神器的核心工作流程:
 *
 *   ┌─→ IDLE ──→ FEEDING ──→ DETECTING ──→ CLASSIFYING
 *   │                                           │
 *   │                                      ┌────▼────┐
 *   │                                      │ REJECT? │──→ EJECTING ──→ IDLE
 *   │                                      └────┬────┘
 *   │                                           │ (accept)
 *   │                                      CRACKING
 *   │                                           │
 *   │                                      ┌────▼────┐
 *   │                              ┌───←──│ RETRY?  │
 *   │                              │      └────┬────┘
 *   │                              │ (retry)   │ (done)
 *   │                              │      VERIFYING
 *   │                              │           │
 *   │                              └─── EJECTING
 *   │
 *   └──── ERROR (任何状态 → 紧急停止 → IDLE)
 */

export enum CrackerState {
  /** 空闲，等待指令 */
  IDLE = 'IDLE',
  /** 正在推入一颗瓜子 */
  FEEDING = 'FEEDING',
  /** 正在通过摄像头检测瓜子位置 */
  DETECTING = 'DETECTING',
  /** 正在判断瓜子朝向 */
  CLASSIFYING = 'CLASSIFYING',
  /** 正在执行开壳操作 */
  CRACKING = 'CRACKING',
  /** 正在验证开壳结果 */
  VERIFYING = 'VERIFYING',
  /** 正在排出残壳 */
  EJECTING = 'EJECTING',
  /** 暂停 */
  PAUSED = 'PAUSED',
  /** 错误/紧急停止 */
  ERROR = 'ERROR',
}

export const STATE_TRANSITIONS: Record<CrackerState, CrackerState[]> = {
  [CrackerState.IDLE]:        [CrackerState.FEEDING, CrackerState.PAUSED, CrackerState.ERROR],
  [CrackerState.FEEDING]:     [CrackerState.DETECTING, CrackerState.ERROR],
  [CrackerState.DETECTING]:   [CrackerState.CLASSIFYING, CrackerState.EJECTING, CrackerState.ERROR],
  [CrackerState.CLASSIFYING]: [CrackerState.CRACKING, CrackerState.EJECTING, CrackerState.ERROR],
  [CrackerState.CRACKING]:    [CrackerState.VERIFYING, CrackerState.CRACKING, CrackerState.ERROR],
  [CrackerState.VERIFYING]:   [CrackerState.EJECTING, CrackerState.CRACKING, CrackerState.ERROR],
  [CrackerState.EJECTING]:    [CrackerState.IDLE, CrackerState.ERROR],
  [CrackerState.PAUSED]:      [CrackerState.IDLE, CrackerState.ERROR],
  [CrackerState.ERROR]:       [CrackerState.IDLE],
};

export interface StateMachineEvent {
  type: 'state_change' | 'error' | 'seed_complete' | 'seed_rejected';
  from: CrackerState;
  to: CrackerState;
  data?: any;
  timestamp: number;
}

export class StateMachine {
  private currentState: CrackerState = CrackerState.IDLE;
  private eventListeners: Map<string, Array<(event: StateMachineEvent) => void>> = new Map();

  get state(): CrackerState {
    return this.currentState;
  }

  /**
   * 尝试切换到目标状态
   * @throws 如果状态转换不合法
   */
  transition(to: CrackerState, data?: any): boolean {
    const from = this.currentState;
    const allowed = STATE_TRANSITIONS[from];

    if (!allowed.includes(to)) {
      const err = new Error(`Invalid state transition: ${from} → ${to}`);
      this.emit('error', { type: 'error', from, to, data: err.message, timestamp: Date.now() });
      return false;
    }

    this.currentState = to;
    const event: StateMachineEvent = {
      type: 'state_change',
      from,
      to,
      data,
      timestamp: Date.now(),
    };
    this.emit('state_change', event);
    return true;
  }

  /**
   * 直接设置状态 (仅用于错误恢复)
   */
  forceState(state: CrackerState): void {
    this.currentState = state;
  }

  /**
   * 是否处于可工作状态
   */
  get isOperational(): boolean {
    return this.currentState !== CrackerState.ERROR && this.currentState !== CrackerState.PAUSED;
  }

  /**
   * 是否处于空闲
   */
  get isIdle(): boolean {
    return this.currentState === CrackerState.IDLE;
  }

  /**
   * 事件监听
   */
  on(event: string, listener: (event: StateMachineEvent) => void): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.push(listener);
    this.eventListeners.set(event, listeners);
  }

  private emit(event: string, data: StateMachineEvent): void {
    const listeners = this.eventListeners.get(event) || [];
    for (const listener of listeners) {
      try {
        listener(data);
      } catch {
        // 静默处理监听器异常
      }
    }
  }

  /**
   * 重置到初始状态
   */
  reset(): void {
    this.currentState = CrackerState.IDLE;
  }
}
