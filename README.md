
# Web2JSONFeed 项目

## 项目简介
将网页内容转换为JSON格式的订阅源工具，基于Deno运行时开发，支持多平台部署。

## 环境要求
- 已安装Deno（版本≥1.30.0）
- 支持Windows/macOS/Linux系统

## 快速开始
### 1. 克隆项目
```bash
git clone https://github.com/your-repo/web2jsonfeed.git
cd web2jsonfeed
```
### 2. 配置环境变量
复制示例环境变量文件并填写API密钥：
```bash
cp .env.example .env
```

### 3. 启动服务
通过Deno任务启动项目（已在`deno.json`中配置任务）：
```bash
 deno task start
```
服务启动后，访问`http://localhost:8000?ai=openai&url=https://example.com` 即可获取转换后的JSON订阅源。
