#!/usr/bin/env python3
"""Convert WeChat editor HTML to markdown for blog posts.
Keeps base64 images as <img> tags so they render in Astro."""
import os, re

def html_to_md(html):
    """Convert WeChat HTML to markdown, preserving images."""
    text = html

    # Remove style blocks
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)

    # Handle headings
    for i in range(6, 0, -1):
        text = re.sub(rf'<h{i}[^>]*>(.*?)</h{i}>', f'\n\n{"#" * i} \\1\n\n', text, flags=re.DOTALL)

    # Handle line breaks
    text = re.sub(r'<br\s*/?>', '\n', text)

    # Handle paragraphs
    text = re.sub(r'<p[^>]*>(.*?)</p>', '\n\n\\1\n\n', text, flags=re.DOTALL)

    # Handle bold/strong
    text = re.sub(r'<strong[^>]*>(.*?)</strong>', '**\\1**', text, flags=re.DOTALL)
    text = re.sub(r'<b[^>]*>(.*?)</b>', '**\\1**', text, flags=re.DOTALL)

    # Handle italic/em
    text = re.sub(r'<em[^>]*>(.*?)</em>', '*\\1*', text, flags=re.DOTALL)
    text = re.sub(r'<i[^>]*>(.*?)</i>', '*\\1*', text, flags=re.DOTALL)

    # Handle blockquote-like divs
    text = re.sub(r'<div[^>]*style="[^"]*border-left[^"]*"[^>]*>', '\n> ', text)

    # Handle list items
    text = re.sub(r'<li[^>]*>', '\n- ', text)

    # Handle non-image divs - remove but keep content
    text = re.sub(r'<div[^>]*>', '', text)
    text = re.sub(r'</div>', '\n', text)

    # Remove all remaining tags EXCEPT img
    text = re.sub(r'<(?!img)[^>]+>', '', text)

    # Add responsive style to img tags
    text = re.sub(r'<img ', '<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" ', text)

    # Decode HTML entities
    text = text.replace('&nbsp;', ' ')
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")

    # Clean up whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = '\n'.join(line.rstrip() for line in text.split('\n'))
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


articles_dir = '/Users/gaojiaqiang/.openclaw/workspace/articles'
blog_dir = '/Users/gaojiaqiang/.openclaw/workspace/learnfordo-site/src/content/blog'

# Known correct titles from draft.md
titles = {
    'Harmful-Compression': 'LLM有害性新发现：所有安全漏洞，都藏在0.0005%的参数里',
    'Agentic-Collapse': '唤醒沉睡的Agent：100条数据让"失忆"模型重获新生',
    'Peer-Preservation': 'AI会为了保护同伴而欺骗人类？Berkeley最新研究揭示多智能体系统隐秘裂缝',
    'Meerkat': '每条日志看起来都无害，合在一起却是勒索攻击——AI Agent安全审计新范式Meerkat',
    'Recursive-Instability': 'LLM的递归不稳定性：当AI学会了"短路径"，却走不了"长路"',
    'MEDLEY-BENCH': '大模型知道自己在做什么吗？MEDLEY-BENCH揭示AI元认知的知行差距',
    'DESPITE-Robot-Planning-Safety': '你的AI机器人正在暗中制造危险：DESPITE揭示规划安全的致命盲区',
    'Superminds-Test': '你的AI Agent为什么不会社交？Superminds Test揭示集体智能的致命瓶颈',
    'Safety-Sabotage': 'AI会暗中破坏安全研究吗？Anthropic的"自审"实验',
}

for dirname in sorted(os.listdir(articles_dir)):
    full_dir = os.path.join(articles_dir, dirname)
    if not os.path.isdir(full_dir):
        continue
    body_path = os.path.join(full_dir, 'draft-body.html')
    if not os.path.exists(body_path):
        continue

    print(f"Converting {dirname}...")
    with open(body_path, 'r', encoding='utf-8') as f:
        html = f.read()

    md_body = html_to_md(html)

    # Get title
    key = dirname.split('_20')[0]
    title = titles.get(key, key.replace('_', ' '))
    pub_date = '2026-01-01'

    draft_path = os.path.join(full_dir, 'draft.md')
    if os.path.exists(draft_path):
        with open(draft_path, 'r', encoding='utf-8') as f:
            draft = f.read()
        m = re.search(r'(\d{4}-\d{2}-\d{2})', dirname)
        if m: pub_date = m.group(1)

    # Get first paragraph as description
    first_p = re.search(r'^(?:\n\n)*([^*\n#<].{20,180})', md_body)
    description = ''
    if first_p:
        description = re.sub(r'[*#\n<>]', '', first_p.group(1).strip())[:180]

    slug = re.sub(r'[^\w\u4e00-\u9fff-]', '', dirname.split('_20')[0]).lower()

    title_esc = title.replace("'", "")
    desc_esc = description.replace("'", "")

    frontmatter = f"---\ntitle: '{title_esc}'\ndescription: '{desc_esc}'\npubDate: '{pub_date}'\n---\n\n"

    output_path = os.path.join(blog_dir, f'{slug}.md')
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(frontmatter + md_body)
    size = os.path.getsize(output_path)
    img_count = len(re.findall(r'<img', md_body))
    print(f"  -> {slug}.md ({size:,} bytes, {img_count} images)")

print("\nDone!")
