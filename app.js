const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();

// 在文件开头添加调试语句
console.log('OPENAI_KEY:', process.env.OPENAI_API_KEY?.substring(0,6)+'...');
['OPENAI_API_KEY', 'CLAUDE_API_KEY','ZHIPU_API_KEY'].forEach(key => {
  if (!process.env[key]) throw new Error(`缺少环境变量: ${key}`);
});

// 支持的AI服务配置
const AI_SERVICES = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-3.5-turbo-1106',
    prompt: `请将以下网页内容转换为标准JSON Feed格式:`
  },
  claude: {
    endpoint: 'https://api.anthropic.com/v1/complete',
    model: 'claude-2',
    prompt: `Human: 请将网页内容转为JSON格式，包含标题、正文、实体和标签\n\nAssistant:`
  },
  zhipu: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash-250414', //glm-4v-flash glm-4-flash
    prompt: `请将以下网页的主体内容部分, 转换为标准 JSON Feed 格式:
    输出格式示例:
    {
        "version": "https://jsonfeed.org/version/1.1",
        "title": "My Example Feed",
        "home_page_url": "https://example.org/",
        "feed_url": "https://example.org/feed",
        "description": "A description of an example feed.",
        "favicon": "https://example.org/favicon.ico",
        "items": [
            {
                "id": "1",
                "url": "https://example.org/item",
                "title": "This is a item.",
                "image": "https://example.org/item.jpg",
                "date_published": "1991-01-01T12:00:00Z",
                "tags": ["tag1", "tag2"],
            }
        ]
    }`
  }
};

// 中间件：参数校验
function validateParams(req, res, next) {
  const { ai, url } = req.query;
  
  if (!ai || !AI_SERVICES[ai]) {
    return res.status(400).json({
      status: "error",
      message: "无效的AI服务参数，支持: " + Object.keys(AI_SERVICES).join(',')
    });
  }

  if (!url || !url.match(/^https?:\/\//)) {
    return res.status(400).json({
      status: "error",
      message: "无效的URL格式"
    });
  }

  next();
}

// 路由处理
app.get('/api/analyze', validateParams, async (req, res) => {
  try {
    const { ai, url } = req.query;
    
    // 1. 获取网页内容
    const html = await fetchWebContent(url);
    
    // 2. 提取主要内容
    const content = extractMainContent(html, url);
    
    // 3. 调用AI处理
    const result = await processWithAI(ai, content);
    
    // 4. 返回格式化结果
    res.json({
      status: "success",
      data: {
        ...result,
        generated_at: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('处理失败:', error);
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

// 获取网页HTML
async function fetchWebContent(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WebAnalyzer/1.0)'
    },
    timeout: 10000
  });
  return response.data;
}

// 内容提取核心逻辑
function extractMainContent(html, url) {
  const $ = cheerio.load(html);
  
  // 优先尝试获取正文内容
  const mainContent = $('#article-body, .article-list, .post-content, .entry-list, main').html() || $('body').html();
  
  return {
    title: $('title').text(),
    content: mainContent || '内容解析失败',
    url: url
  };
}

// AI处理函数
async function processWithAI(serviceName, content) {
  const service = AI_SERVICES[serviceName];
  const apiKey = process.env[`${serviceName.toUpperCase()}_API_KEY`];
  
  if (!apiKey) {
    throw new Error(`未配置${serviceName} API密钥`);
  }

  const payload = {
    model: service.model,
    messages: [
      {role: "system", content: service.prompt},
      {role: "user", content: JSON.stringify(content)}
    ],
    response_format: { type: "json_object" }
  };

  const response = await axios.post(service.endpoint, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
  });

  try {
    return JSON.parse(response.data.choices[0].message.content);
  } catch (e) {
    throw new Error('AI返回结果解析失败');
  }
}

// 错误处理中间件
app.use((err, req, res, next) => {
  res.status(500).json({
    status: "error",
    message: err.message
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}`);
});