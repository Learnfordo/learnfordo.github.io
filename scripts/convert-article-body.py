#!/usr/bin/env python3
"""Convert article_body.html to markdown for blog posts."""
import os, re

def html_to_md(html):
    """Convert WeChat HTML to markdown, preserving images."""
    text = html
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)

    for i in range(6, 0, -1):
        text = re.sub(rf'<h{i}[^>]*>(.*?)</h{i}>', f'\n\n{"#" * i} \\1\n\n', text, flags=re.DOTALL)

    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'<p[^>]*>(.*?)</p>', '\n\n\\1\n\n', text, flags=re.DOTALL)
    text = re.sub(r'<strong[^>]*>(.*?)</strong>', '**\\1**', text, flags=re.DOTALL)
    text = re.sub(r'<b[^>]*>(.*?)</b>', '**\\1**', text, flags=re.DOTALL)
    text = re.sub(r'<em[^>]*>(.*?)</em>', '*\\1*', text, flags=re.DOTALL)
    text = re.sub(r'<i[^>]*>(.*?)</i>', '*\\1*', text, flags=re.DOTALL)
    text = re.sub(r'<div[^>]*style="[^"]*border-left[^"]*"[^>]*>', '\n> ', text)
    text = re.sub(r'<li[^>]*>', '\n- ', text)
    text = re.sub(r'</?div[^>]*>', '\n', text)
    text = re.sub(r'<(?!img)[^>]+>', '', text)
    text = re.sub(r'<img ', '<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" ', text)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = '\n'.join(line.rstrip() for line in text.split('\n'))
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

articles_dir = '/Users/gaojiaqiang/.openclaw/workspace/articles'
blog_dir = '/Users/gaojiaqiang/.openclaw/workspace/learnfordo-site/src/content/blog'

for dirname in sorted(os.listdir(articles_dir)):
    full_dir = os.path.join(articles_dir, dirname)
    if not os.path.isdir(full_dir): continue
    
    body_path = os.path.join(full_dir, 'article_body.html')
    if not os.path.exists(body_path):
        continue

    print(f"Converting {dirname}...")
    with open(body_path, 'r', encoding='utf-8') as f:
        html = f.read()
    md_body = html_to_md(html)

    title = re.sub(r'_.+$', '', dirname).replace('_', ' ')
    pub_date = '2026-01-01'
    draft_path = os.path.join(full_dir, 'draft.md')
    if os.path.exists(draft_path):
        with open(draft_path, 'r', encoding='utf-8') as f:
            draft = f.read()
        m = re.search(r'(\d{4}-\d{2}-\d{2})', dirname)
        if m: pub_date = m.group(1)

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
