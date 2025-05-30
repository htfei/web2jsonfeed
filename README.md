
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
```env
OPENAI_API_KEY=sk-xxx
CLAUDE_API_KEY=sk-xxx
ZHIPU_API_KEY=xxx
```
### 3. 启动服务
通过Deno任务启动项目（已在`deno.json`中配置任务）：
```bash
 deno task start
```
服务启动后，访问`http://localhost:3000`查看接口文档。

## 依赖管理
项目使用Deno原生依赖管理，依赖会自动缓存到Deno系统目录（默认`~/.cache/deno`）。无需手动管理`node_modules`目录。

## 注意事项
- `.env`文件包含敏感信息，请勿提交到版本控制系统。
- 首次运行时Deno会自动下载依赖，可能需要等待1-2分钟。
- 若需修改启动参数，可在`deno.json`的`tasks`字段中调整`start`任务配置。


## API文档
```http
GET /api/analyze?ai=openai&url=https://example.com
```