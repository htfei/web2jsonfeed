const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
require('dotenv').config(); // 加载.env文件

// 创建缓存实例，设置默认过期时间为5分钟（300秒）
const myCache = new NodeCache({ stdTTL: 300 });
const app = express();

// 配置速率限制：每分钟最多10次请求
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 100, // 每个IP最多10次
  message: '请求过于频繁，请稍后再试',
  standardHeaders: true, // 返回RateLimit头信息
  legacyHeaders: false // 禁用X-RateLimit头信息
});

// 应用速率限制到/api/analyze路由
app.use('/api/analyze', limiter);

const requiredKeys = ['OPENAI_API_KEY', 'CLAUDE_API_KEY', 'ZHIPU_API_KEY', 'XUNFEI_API_KEY'];
// 输出各API Key的加载状态
requiredKeys.forEach(key => {
  if (!process.env[key]) {
    console.warn(`缺少环境变量: ${key}`);
  } else {
    console.log(`已加载 ${key}:`, process.env[key]?.substring(0,6)+'...');
  }
});

// 全局共用提示词
const COMMON_PROMPT = 
 `请将以下网页的主体内容部分, 转换为标准 JSON Feed 格式:
  - 以下示例中的字段必须都包含，并且不能用示例中的默认值，必须根据实际内容进行填充。
  - id 字段必须是一个唯一的数字标识符，你可以通过 url 字段提取出来。
  - url 字段必须是文章的完整 URL。
  - title 字段必须是文章的标题。
  - image 字段必须是文章的主要图片 URL。如果没有，你可以从文章内容中提取一个图片 URL。
  - date_published 字段必须是文章的发布日期。你可能解析到类似“2分钟前”，但需要转换为 ISO 8601 格式。
  - tags 字段是一个字符串数组，包含文章的标签，建议2~3个，最多5个。如果没有，你可以根据文章标题生成几个。
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
              "title": "This is a item title.",
              "image": "https://example.org/item.jpg",
              "date_published": "1991-01-01T12:00:00Z",
              "tags": ["tag1", "tag2"],
          }
      ]
  }`;

// 支持的AI服务配置
const AI_SERVICES = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-3.5-turbo-1106',
    apiKey: process.env.OPENAI_API_KEY,
  },
  claude: {
    endpoint: 'https://api.anthropic.com/v1/complete',
    model: 'claude-2',
    apiKey: process.env.CLAUDE_API_KEY,
  },
  zhipu: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash-250414', //glm-4v-flash glm-4-flash 
    apiKey: process.env.ZHIPU_API_KEY,
  },
  xunfei: {
    endpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_tool',
    model: 'xunfei-chat-pro',
    apiKey: process.env.XUNFEI_API_KEY,
  }
};

// 中间件：参数校验
function validateParams(req, res, next) {
  const { ai, url } = req.query;
  
  // 允许ai为空或'rebot'时使用自动提取
  if (ai && ai !== 'rebot' && !AI_SERVICES[ai]) {
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
    console.log(`处理请求: ${ai} ${url}`);
    
    // 生成缓存键（基于ai和url）
    const cacheKey = `analyze:${ai}:${url}`;
    // 检查缓存是否存在
    const cachedResult = myCache.get(cacheKey);
    if (cachedResult) {
      console.log('使用缓存结果');
      return res.json({
        status: "success",
        data: {
          ...cachedResult,
          generated_at: new Date().toISOString()
        }
      });
    }
    
    // 1. 获取网页内容
    const html = await fetchWebContent(url);
    
    // 2. 提取主要内容（包含cheerio实例）
    const content = extractMainContent(html, url);
    content.html = html; // 保留原始HTML供可能的后续使用
    
    // 3. 选择处理方式（自动提取或AI处理）
    const result = (ai === 'rebot' || !ai)
      ? await autoExtractContent(content)
      : await processWithAI(ai, content);
    
    // 4. 存储结果到缓存
    myCache.set(cacheKey, result);
    // 返回格式化结果
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

// 自动提取内容生成JSON Feed的函数
async function autoExtractContent(content) {
  const $ = content.$; // 使用extractMainContent返回的cheerio实例
  
  // 提取文章列表（扩展常见列表选择器，覆盖更多网页结构）
  const articleItems = $('main article, .article-list .item, .post-list .post, .entry-list .entry, .posts .post, div[class*="article"], div[class*="post"], .topic-item').toArray();
  const items = articleItems.map((item, index) => {
    const $item = $(item);
    const itemTitle = $item.find('h2, h3').text().trim() || '未识别条目标题';
    // 优先获取a标签href，处理相对路径
    const rawUrl = $item.find('a').attr('href') || $('link[rel="canonical"]').attr('href') || content.url;
    const itemUrl = new URL(rawUrl, content.url).href; // 转换为绝对路径
    const itemImage = $item.find('img').attr('src') || $('meta[property="og:image"]').attr('content') || '';
    // 优先从meta标签获取发布时间（支持og:published_time和twitter:date）
    const metaDate = $('meta[property="og:published_time"], meta[name="twitter:date"]').attr('content') || new Date().toISOString();
    const itemDate = $item.find('.date, .post-time').text() || metaDate;
    // 扩展标签提取源（支持tags、categories、keywords）
    const itemTags = $item.find('.tags a, .categories a, .keyword a').map((i, el) => $(el).text()).get().slice(0,5) || ['默认标签'];

    return {
      id: `${index}`,
      url: new URL(itemUrl, content.url).href,
      title: itemTitle,
      image: new URL(itemImage, content.url).href,
      date_published: new Date(itemDate).toISOString(),
      tags: itemTags
    };
  });
  
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: content.title || '未识别标题',
    home_page_url: content.url,
    feed_url: `${content.url}/feed`,
    description: $('meta[name="description"]').attr('content') || '自动解析的网页内容',
    favicon: $('link[rel="icon"]').attr('href') || '',
    items: items.length > 0 ? items : [{
      id: 1,
      url: content.url,
      title: content.title || '未识别标题',
      image: $('meta[property="og:image"]').attr('content') || $('img').first().attr('src') || '',
      date_published: new Date().toISOString(),
      tags: $('meta[name="keywords"]').attr('content')?.split(',').slice(0,5) || ['默认标签']
    }]
  };
}

// 内容提取核心逻辑
function extractMainContent(html, url) {
  const $ = cheerio.load(html);
  
  // 优先尝试获取正文内容
  const mainContent = $('#article-body, .article-list, .post-content, .entry-list, main').html() || $('body').html();
  
  return {
    $: $, // 返回cheerio实例避免重复加载
    title: $('title').text(),
    content: mainContent || '内容解析失败',
    url: url
  };
}

// AI处理函数
async function processWithAI(serviceName, content) {
  const service = AI_SERVICES[serviceName];
  
  if(!service.apiKey){
    throw new Error(`未配置AI服务 ${serviceName} 的API密钥`);
  }

  const payload = {
    model: service.model,
    messages: [
      {role: "system", content: COMMON_PROMPT},
      {role: "user", content: JSON.stringify(content)}
    ],
    response_format: { type: "json_object" }
  };

  const response = await axios.post(service.endpoint, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${service.apiKey}`
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