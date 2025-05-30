// deno-lint-ignore-file require-await
// 网页内容转JSON Feed服务（Deno实现）
// 功能与app.js完全一致，仅适配Deno运行时

// 导入Deno兼容库
import 'npm:dotenv@16.5.0/config.js'; // 自动加载.env文件到Deno.env
import * as cheerio from "npm:cheerio@1.0.0";

// 必需的环境变量列表（与app.js完全一致）
const requiredKeys = ['OPENAI_API_KEY', 'CLAUDE_API_KEY', 'ZHIPU_API_KEY', 'XUNFEI_API_KEY'];
// 输出各API Key的加载状态
requiredKeys.forEach(key => {
  const value = Deno.env.get(key);
  if (!value) {
    console.warn(`缺少环境变量: ${key}`);
  } else {
    console.log(`已加载 ${key}:`, value.substring(0, 6) + '...');
  }
});

// 全局缓存（替代node-cache）
const myCache = new Map<string, any>();
const CACHE_TTL = 300; // 5分钟

// 全局共用提示词（与app.js完全一致）
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
  {"version": "https://jsonfeed.org/version/1.1","title": "My Example Feed","home_page_url": "https://example.org/","feed_url": "https://example.org/feed","description": "A description of an example feed.","favicon": "https://example.org/favicon.ico","items": [{"id": "1","url": "https://example.org/item","title": "This is a item title.","image": "https://example.org/item.jpg","date_published": "1991-01-01T12:00:00Z","tags": ["tag1", "tag2"]}]}
`;

// 支持的AI服务配置（与app.js完全一致）
const AI_SERVICES = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-3.5-turbo-1106',
    apiKey: Deno.env.get('OPENAI_API_KEY')
  },
  claude: {
    endpoint: 'https://api.anthropic.com/v1/complete',
    model: 'claude-2',
    apiKey: Deno.env.get('CLAUDE_API_KEY')
  },
  zhipu: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash-250414',
    apiKey: Deno.env.get('ZHIPU_API_KEY')
  },
  xunfei: {
    endpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_tool',
    model: 'xunfei-chat-pro',
    apiKey: Deno.env.get('XUNFEI_API_KEY')
  }
};

// 速率限制中间件（与app.js逻辑一致）
const createRateLimiter = () => {
  const requestCounts = new Map<string, { count: number; timestamp: number }>();
  return (req: Request) => {
    const ip = req.headers.get('x-forwarded-for') || '127.0.0.1';
    const now = Date.now();
    const record = requestCounts.get(ip);

    if (!record || now - record.timestamp > 60 * 1000) {
      requestCounts.set(ip, { count: 1, timestamp: now });
      return true;
    }

    if (record.count >= 100) {
      return false;
    }

    record.count++;
    return true;
  };
};
const limiter = createRateLimiter();

// 主处理函数（与app.js路由逻辑一致）
const handler = async (req: Request): Promise<Response> => {
  if (new URL(req.url).pathname !== '/api/analyze') {
    return new Response('Not Found', { status: 404 });
  }

  if (!limiter(req)) {
    return new Response(JSON.stringify({ status: "error", message: "请求过于频繁，请稍后再试" }), {
      headers: { 'Content-Type': 'application/json' },
      status: 429
    });
  }

  try {
    const { ai, url } = Object.fromEntries(new URL(req.url).searchParams.entries());
    if (!url || !url.startsWith('http')) {
      return new Response(JSON.stringify({ status: "error", message: "无效的URL格式" }), { headers: { 'Content-Type': 'application/json' }, status: 400 });
    }
    if (ai && !AI_SERVICES[ai] && ai !== 'rebot') {
      return new Response(JSON.stringify({ status: "error", message: "无效的AI服务参数" }), { headers: { 'Content-Type': 'application/json' }, status: 400 });
    }

    const cacheKey = `analyze:${ai}:${url}`;
    if (myCache.has(cacheKey)) {
      const cachedResult = myCache.get(cacheKey);
      return new Response(JSON.stringify({ status: "success", data: { ...cachedResult, generated_at: new Date().toISOString() } }), { headers: { 'Content-Type': 'application/json' } });
    }

    const html = await fetchWebContent(url);
    const content = extractMainContent(html, url);
    const result = ai === 'rebot' || !ai ? await autoExtractContent(content) : await processWithAI(ai, content);

    myCache.set(cacheKey, result);
    setTimeout(() => myCache.delete(cacheKey), CACHE_TTL * 1000);

    return new Response(JSON.stringify({ status: "success", data: { ...result, generated_at: new Date().toISOString() } }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ status: "error", message: error.message }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
  }
};

// 获取网页HTML（替换axios为Deno fetch）
async function fetchWebContent(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WebAnalyzer/1.0)' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP错误: ${response.status}`);
  return response.text();
}

// 自动提取内容（与app.js逻辑一致）
async function autoExtractContent(content: { $: cheerio.Root; title: string; url: string }): Promise<any> {
  const $ = content.$;
  const articleItems = $('main article, .article-list .item, .post-list .post, .entry-list .entry, .posts .post, div[class*="article"], div[class*="post"], .topic-item').toArray();
  const items = articleItems.map((item, index) => {
    const $item = $(item);
    const itemTitle = $item.find('h2, h3').text().trim() || '未识别条目标题';
    const rawUrl = $item.find('a').attr('href') || $('link[rel="canonical"]').attr('href') || content.url;
    const itemUrl = new URL(rawUrl, content.url).href;
    const itemImage = $item.find('img').attr('src') || $('meta[property="og:image"]').attr('content') || '';
    const metaDate = $('meta[property="og:published_time"], meta[name="twitter:date"]').attr('content') || new Date().toISOString();
    const itemDate = $item.find('.date, .post-time').text() || metaDate;
    const itemTags = $item.find('.tags a, .categories a, .keyword a').map((i, el) => $(el).text()).get().slice(0, 5) || ['默认标签'];

    return {
      id: `${index}`,
      url: itemUrl,
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
      tags: $('meta[name="keywords"]').attr('content')?.split(',').slice(0, 5) || ['默认标签']
    }]
  };
}

// 内容提取核心逻辑（与app.js一致）
function extractMainContent(html: string, url: string): { $: cheerio.Root; title: string; content: string; url: string } {
  const $ = cheerio.load(html);
  const mainContent = $('#article-body, .article-list, .post-content, .entry-list, main').html() || $('body').html();
  return { $, title: $('title').text(), content: mainContent || '内容解析失败', url };
}

// AI处理函数（与app.js逻辑一致）
async function processWithAI(serviceName: string, content: { $: cheerio.Root; title: string; content: string; url: string }): Promise<any> {
  const service = AI_SERVICES[serviceName as keyof typeof AI_SERVICES];
  if (!service.apiKey) throw new Error(`未配置AI服务 ${serviceName} 的API密钥`);

  const payload = {
    model: service.model,
    messages: [
      { role: "system", content: COMMON_PROMPT },
      { role: "user", content: JSON.stringify(content) }
    ],
    response_format: { type: "json_object" }
  };

  const response = await fetch(service.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${service.apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(`AI服务请求失败：${response.status}`);
  const data = await response.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch (e) {
    throw new Error('AI返回结果解析失败');
  }
}

// 启动服务（Deno标准HTTP服务）
Deno.serve(handler, { port: 8000 });