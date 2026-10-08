# seed-cracker-ai

Seed Cracker AI 嗑瓜子神器 AI 驱动程序 — 基于计算机视觉和深度学习的智能瓜子开壳控制系统 命令 npm install npx tsc --noEmit # 类型检查 npx eslint src/ # 代码规范 npx jest --coverage # 测试 npx tsc # 构建 架构 src/ ├── ai/ │ ├── state-machine.ts ← 9 状态状态机 (IDLE→FEEDING→...→EJECTING)

## 用途与 Target 判定

种子/固件侧 AI 相关

- 移动端：不适用
- 智能硬件：需要

## 目标平台

| 平台 | 方式 | 产出 |
|------|------|------|
| 手表 | 窄屏适配 | 同 App |
| 智能戒指 | DeviceOrientation / 专用 SDK | — |
| 智能手杖或其他硬件 | DeviceMotion / BLE / 固件 | — |

## 技术栈信号

- 检测到：node

## 命令

```bash
npm install
npm test
npm run build
npm run start
npm run dev
```

## 状态

已归档。默认只做必要修复与知识库同步，不新开大范围需求。

## 智能硬件约定

- 戒指：DeviceOrientation；手杖：DeviceMotion；手表窄屏 CSS
- 复用 shared / 兄弟项目模块，避免复制漂移

## 助手约束

- Loop：先定可验证 Done 与停止条件；每切片过验证环；失败回灌；详见 docs/LOOP_ENGINEERING.md
- Harness：遵循根 AGENTS「Harness Engineering」；Guide=本文件，Sensor=测试/CI；同类失误二次须沉淀规则或测试（棘轮）。详见 docs/HARNESS_ENGINEERING.md
- 遵循仓库根 `/Users/skat/AGENTS.md` 与本文件的用途判定
- 可选 Target 可搁置；不适用形态不要硬加
- 改动聚焦；公共逻辑抽离复用
