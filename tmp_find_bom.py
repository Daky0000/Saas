import os

found = 0
for root, dirs, files in os.walk('.'):
    # Skip common large directories from scan
    if any(p in root for p in ['.git', 'node_modules', '.vite']):
        continue
    for f in files:
        if f.endswith(('.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html', '.md')):
            path = os.path.join(root, f)
            try:
                with open(path, 'rb') as fh:
                    b = fh.read(4)
            except Exception:
                continue
            if b.startswith(b'\xff\xfe') or b.startswith(b'\xfe\xff'):
                print('BOM:', path)
                found += 1

print('found', found, 'files with BOM')
