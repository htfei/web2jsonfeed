# Web内容解析API

## 功能特性
- 支持多AI服务（OpenAI/Claude/智谱清言）
- 网页内容智能解析与结构化
- JSON Feed标准格式输出

## 安装步骤
```bash
npm install
```

## 配置说明
1. 复制环境模板
```bash
cp .env.example .env
```
2. 填写API密钥
```env
OPENAI_API_KEY=sk-xxx
CLAUDE_API_KEY=sk-xxx
ZHIPU_API_KEY=xxx
```

## 启动服务
```bash
node app.js
```

## API文档
```http
GET /api/analyze?ai=openai&url=https://example.com
```