# Seed Cracker AI — Engineering Hardening v2

**日期:** 2026-06-07
**变更:** v2 workflow 加固 + Agent 化

## 安全修复

- 🔴 CORS origin '*' → 建议限制 (审计标记)
- 🟡 舵机堵转无超时 → 审计标记
- 🟡 WebSocket 无消息大小限制 → 审计标记

## Agent 化

- ✅ CrackerAgent — 自主决策层 (包裹 AICrackerOrchestrator)
  - 自适应速度: 成功率 > 90% → 加速 seedInterval; < 50% → 减速
  - 自适应角度: 从历史成功记录学习最佳 crackAngle
  - 自动停机: 连续 10 次失败 → emit auto_stop
  - 预测性维护: 5000 次舵机动作 → emit maintenance_alert
  - 学习等级: 0→1→2→3 (初始→学习→优化→专家)
  - markMaintenanceDone() 重置保养周期

## 测试

- ✅ cracker-agent.test.ts — 6 用例
  - 连续失败自动停机
  - 连续成功不触发停机
  - insight 事件包含完整字段
  - reset 清空学习状态
  - 保养提醒
  - markMaintenanceDone 重置计数

## CI/CD

- ✅ typecheck → lint → test → build 串行依赖
- ✅ 移除 `|| echo 'No tests'` 静默失败
- ✅ 新增 tsc --noEmit 类型检查
- ✅ 新增独立的 lint job
