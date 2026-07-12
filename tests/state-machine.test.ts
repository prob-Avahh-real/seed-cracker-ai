/**
 * 状态机单元测试
 */

import { StateMachine, CrackerState, STATE_TRANSITIONS } from '../src/ai/state-machine';

describe('StateMachine', () => {
  let sm: StateMachine;

  beforeEach(() => {
    sm = new StateMachine();
  });

  test('初始状态为 IDLE', () => {
    expect(sm.state).toBe(CrackerState.IDLE);
  });

  test('合法状态转换', () => {
    expect(sm.transition(CrackerState.FEEDING)).toBe(true);
    expect(sm.state).toBe(CrackerState.FEEDING);
  });

  test('非法状态转换返回 false', () => {
    // IDLE → CRACKING 非法
    expect(sm.transition(CrackerState.CRACKING)).toBe(false);
    expect(sm.state).toBe(CrackerState.IDLE);
  });

  test('完整工作流 IDLE → FEEDING → DETECTING → CLASSIFYING → CRACKING', () => {
    expect(sm.transition(CrackerState.FEEDING)).toBe(true);
    expect(sm.transition(CrackerState.DETECTING)).toBe(true);
    expect(sm.transition(CrackerState.CLASSIFYING)).toBe(true);
    expect(sm.transition(CrackerState.CRACKING)).toBe(true);
    expect(sm.state).toBe(CrackerState.CRACKING);
  });

  test('error 状态只能回到 IDLE', () => {
    sm.forceState(CrackerState.ERROR);
    expect(sm.transition(CrackerState.IDLE)).toBe(true);
    expect(sm.transition(CrackerState.FEEDING)).toBe(true);
    expect(sm.state).toBe(CrackerState.FEEDING);
  });

  test('DETECTING → EJECTING (未检测到瓜子)', () => {
    sm.forceState(CrackerState.DETECTING);
    expect(sm.transition(CrackerState.EJECTING)).toBe(true);
    expect(sm.state).toBe(CrackerState.EJECTING);
  });

  test('isOperational 和 isIdle', () => {
    expect(sm.isIdle).toBe(true);
    expect(sm.isOperational).toBe(true);

    sm.forceState(CrackerState.ERROR);
    expect(sm.isOperational).toBe(false);

    sm.reset();
    expect(sm.isIdle).toBe(true);
  });

  test('状态转换事件触发', () => {
    const listener = jest.fn();
    sm.on('state_change', listener);

    sm.transition(CrackerState.FEEDING);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].from).toBe(CrackerState.IDLE);
    expect(listener.mock.calls[0][0].to).toBe(CrackerState.FEEDING);
  });

  test('非法转换触发 error 事件', () => {
    const listener = jest.fn();
    sm.on('error', listener);

    sm.transition(CrackerState.CRACKING);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('所有合法转换都有定义', () => {
    for (const [from, toList] of Object.entries(STATE_TRANSITIONS)) {
      for (const to of toList) {
        sm.forceState(from as CrackerState);
        sm.transition(to);
        // 不抛异常即为通过
      }
    }
  });
});
