// Supabase Edge Function Deno实现版本
// 文件描述：将指定网页内容转换为JSON Feed格式的Deno版本服务
// 作者：用户
// 创建时间：2024年

// 使用Deno标准库的HTTP服务模块
import { serve } from "https://deno.land/std@0.204.0/http/server.ts";
// 使用npm源的cheerio库解析HTML，指定版本确保兼容性
import cheerio from "npm:cheerio@1.0.0-rc.12";

/**
 * 提取网页主内容区域
 * @param html 目标网页的HTML字符串
 * @returns 主内容区域的HTML字符串（若未找到则返回空字符串）
 */
function extractMainContent(html: string): string {
  const $ = cheerio.load(html);
  // 支持多种常见主内容选择器，提高兼容性
  const selectors = ["main", "article", ".main-content", "#content"];
  for (const selector of selectors) {
    const content = $(selector).first();
    if (content.length) return content.html() || "";
  }
  //  fallback到body内容
  return $("body").html() || "";
}

/**
 * 自动提取文章列表信息
 * @param html 目标网页的HTML字符串
 * @param baseUrl 目标网页的基础URL（用于解析相对路径）
 * @returns 文章列表数组（包含标题和完整URL）
 */
function autoExtractContent(html: string, baseUrl: string): Array<{ title: string; url: string }> {
  const $ = cheerio.load(html);
  const items: Array<{ title: string; url: string }> = [];
  // 扩展常见列表选择器覆盖更多网页结构
  const listSelectors = [
    "ul.articles", "ol.posts", "div.article-list",
    "section.blog-list", "div.news-list", "div.posts-container"
  ];

  for (const selector of listSelectors) {
    const listItems = $(selector).find("li, article, .post-item");
    if (listItems.length > 0) {
      listItems.each((_, el) => {
        const $item = $(el);
        const titleEl = $item.find("h2, h3, .post-title");
        const linkEl = $item.find("a[href]").first();
        const title = titleEl.text().trim() || "未命名文章";
        const url = linkEl.length ? new URL(linkEl.attr("href"), baseUrl).href : baseUrl;
        items.push({ title, url });
      });
      return items;
    }
  }

  // 未找到列表时提取单篇文章信息
  const title = $("h1, h2, .page-title").text().trim() || "未命名文章";
  return [{ title, url: baseUrl }];
}

// 启动Deno HTTP服务，处理所有GET请求
serve(async (req: Request) => {
  try {
    const requestUrl = new URL(req.url);
    const targetUrl = requestUrl.searchParams.get("url");
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "请提供目标URL参数（?url=目标网址）" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 验证目标URL格式有效性
    new URL(targetUrl);

    // 获取目标网页内容
    const response = await fetch(targetUrl);
    if (!response.ok) {
      return new Response(JSON.stringify({ error: `目标网页请求失败：${response.statusText}` }), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }
    const html = await response.text();

    // 提取内容并返回JSON响应
    const mainContent = extractMainContent(html);
    const items = autoExtractContent(html, targetUrl);
    return new Response(JSON.stringify({ mainContent, items }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});