#!/usr/bin/env python3
"""Quick HTML to markdown converter for WeChat editor HTML."""
import os, re, sys

def html_to_md(html):
    """Convert WeChat HTML to markdown using regex."""
    text = html

    # Remove style blocks
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)

    # Handle images - replace base64 with placeholder
    text = re.sub(r'<img[^>]*src="data:[^"]*"[^>]*/?>', '\n\n*[图片]*\n\n', text)
    text = re.sub(r'<img[^>]*src="([^"]+)"[^>]*/?>', '\n\n![image](\\1)\n\n', text)

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

    # Handle divs that are just block containers (remove them)
    text = re.sub(r'</?div[^>]*>', '\n', text)

    # Remove all remaining tags
    text = re.sub(r'<[^>]+>', '', text)

    # Decode HTML entities
    text = text.replace('&nbsp;', ' ')
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")

    # Clean up whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = '\n'.join(line.strip() for line in text.split('\n'))
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


articles_dir = '/Users/gaojiaqiang/.openclaw/workspace/articles'
blog_dir = '/Users/gaojiaqiang/.openclaw/workspace/learnfordo-site/src/content/blog'

for dirname in sorted(os.listdir(articles_dir)):
    full_dir = os.path.join(articles_dir, dirname)
    if not os.path.isdir(full_dir):
        continue
    body_path = os.path.join(full_dir, 'draft-body.html')
    draft_path = os.path.join(full_dir, 'draft.md')
    if not os.path.exists(body_path):
        continue

    print(f"Converting {dirname}...")
    with open(body_path, 'r', encoding='utf-8') as f:
        html = f.read()

    md_body = html_to_md(html)

    title = re.sub(r'_.+$', '', dirname).replace('_', ' ')
    description = ''
    pub_date = '2026-01-01'

    if os.path.exists(draft_path):
        with open(draft_path, 'r', encoding='utf-8') as f:
            draft = f.read()
        m = re.search(r'(\d{4}-\d{2}-\d{2})', dirname)
        if m: pub_date = m.group(1)
        m = re.search(r'[标题T]itle[^:]*:\s*(.+)', draft)
        if m: title = m.group(1).strip()

    # Get first meaningful paragraph as description
    first_p = re.search(r'^(?:\n\n)*([^*\n].{20,180})', md_body)
    if first_p:
        description = re.sub(r'[*#\n]', '', first_p.group(1).strip())[:180]

    slug = re.sub(r'[^\w\u4e00-\u9fff-]', '', dirname.split('_20')[0]).lower()

    title_esc = title.replace("'", "")
    desc_esc = description.replace("'", "")

    frontmatter = f"---\ntitle: '{title_esc}'\ndescription: '{desc_esc}'\npubDate: '{pub_date}'\n---\n\n"

    output_path = os.path.join(blog_dir, f'{slug}.md')
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(frontmatter + md_body)
    size = os.path.getsize(output_path)
    print(f"  done - {slug}.md ({size:,} bytes, {len(md_body):,} chars)")

print("\nDone!")
