/**
 * CrackerAgent 测试 — 自主决策层
 */

import { CrackerAgent } from '../src/ai/cracker-agent';
import { AICrackerOrchestrator, SeedProcessResult } from '../src/ai/orchestrator';
import { CrackerState } from '../src/ai/state-machine';
import { getConfig } from '../src/config';

// 创建轻量 mock orchestrator，不需要真实硬件
function createMockOrchestrator(): AICrackerOrchestrator {
  const orch = new AICrackerOrchestrator();
  // 阻止 init 调用真实硬件
  (orch as any).init = async () => {};
  return orch;
}

describe('CrackerAgent', () => {
  let agent: CrackerAgent;
  let orchestrator: AICrackerOrchestrator;

  beforeEach(() => {
    orchestrator = createMockOrchestrator();
    agent = new CrackerAgent(orchestrator);
  });

  afterEach(() => {
    agent.removeAllListeners();
  });

  test('auto stop after consecutive failures', (done) => {
    agent.on('auto_stop', (reason: string) => {
      expect(reason).toContain('连续');
      expect(reason).toContain('失败');
      done();
    });

    // 模拟 10 次连续失败
    const failResult: SeedProcessResult = {
      seedId: 1,
      success: false,
      orientation: 'unknown',
      quality: null,
      crackQuality: null,
      retries: 0,
      durationMs: 100,
    };

    for (let i = 0; i < 10; i++) {
      orchestrator.emit('seed', { ...failResult, seedId: i + 1 });
    }
  });

  test('consecutive successes do not trigger auto stop', () => {
    const autoStopFn = jest.fn();
    agent.on('auto_stop', autoStopFn);

    const successResult: SeedProcessResult = {
      seedId: 1,
      success: true,
      orientation: 'tip_up',
      quality: { crackable: true, score: 85, defects: [] },
      crackQuality: { success: true, separationScore: 0.9, kernelIntact: true, reason: 'ok' },
      retries: 0,
      durationMs: 200,
    };

    for (let i = 0; i < 15; i++) {
      orchestrator.emit('seed', { ...successResult, seedId: i + 1 });
    }

    expect(autoStopFn).not.toHaveBeenCalled();
  });

  test('emits insight event with stats', (done) => {
    agent.on('insight', (insight) => {
      expect(insight).toHaveProperty('suggestedInterval');
      expect(insight).toHaveProperty('suggestedAngle');
      expect(insight).toHaveProperty('maintenanceNeeded');
      expect(insight).toHaveProperty('adaptationLevel');
      done();
    });

    orchestrator.emit('stats', {
      totalProcessed: 25,
      successful: 20,
      failed: 3,
      rejected: 2,
      averageTimeMs: 150,
      successRate: 0.8,
      currentState: CrackerState.IDLE,
    });
  });

  test('reset clears learning state', () => {
    const successResult: SeedProcessResult = {
      seedId: 1,
      success: true,
      orientation: 'tip_up',
      quality: { crackable: true, score: 80, defects: [] },
      crackQuality: { success: true, separationScore: 0.8, kernelIntact: true, reason: 'ok' },
      retries: 0,
      durationMs: 100,
    };

    for (let i = 0; i < 10; i++) {
      orchestrator.emit('seed', successResult);
    }

    agent.reset();

    // Reset 后又有 10 次连续失败 — 应该再次触发 auto_stop
    const autoStopFn = jest.fn();
    agent.on('auto_stop', autoStopFn);

    const failResult: SeedProcessResult = { ...successResult, success: false };
    for (let i = 0; i < 10; i++) {
      orchestrator.emit('seed', failResult);
    }

    expect(autoStopFn).toHaveBeenCalled();
  });

  test('maintenance alert after 5000 servo cycles', (done) => {
    agent.on('maintenance_alert', (reason: string) => {
      expect(reason).toContain('保养');
      done();
    });

    const result: SeedProcessResult = {
      seedId: 1,
      success: true,
      orientation: 'tip_up',
      quality: { crackable: true, score: 80, defects: [] },
      crackQuality: { success: true, separationScore: 0.8, kernelIntact: true, reason: 'ok' },
      retries: 0,
      durationMs: 100,
    };

    // 触发 5000+ 次
    for (let i = 0; i < 5001; i++) {
      orchestrator.emit('seed', { ...result, seedId: i + 1 });
    }
  });

  test('markMaintenanceDone resets cycle counter', (done) => {
    // 注册一次 maintenance_alert
    agent.once('maintenance_alert', () => {
      agent.markMaintenanceDone();

      // 再注册一次以验证重置后不立即触发
      const secondAlert = jest.fn();
      agent.on('maintenance_alert', secondAlert);

      // 少次不应触发
      const result: SeedProcessResult = {
        seedId: 1,
        success: true,
        orientation: 'tip_up',
        quality: { crackable: true, score: 80, defects: [] },
        crackQuality: { success: true, separationScore: 0.8, kernelIntact: true, reason: 'ok' },
        retries: 0,
        durationMs: 100,
      };

      for (let i = 0; i < 10; i++) {
        orchestrator.emit('seed', { ...result, seedId: i + 1 });
      }

      expect(secondAlert).not.toHaveBeenCalled();
      done();
    });

    const result: SeedProcessResult = {
      seedId: 1,
      success: true,
      orientation: 'tip_up',
      quality: { crackable: true, score: 80, defects: [] },
      crackQuality: { success: true, separationScore: 0.8, kernelIntact: true, reason: 'ok' },
      retries: 0,
      durationMs: 100,
    };

    for (let i = 0; i < 5001; i++) {
      orchestrator.emit('seed', { ...result, seedId: i + 1 });
    }
  }, 15000);
});
