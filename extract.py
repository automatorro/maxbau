import re
import json

html = open('brands.html', encoding='utf-8').read()
slugs = list(set(re.findall(r'href=["\'](?:https?://maxbau.ro)?/?marci/([a-z0-9-]+)["\']', html, re.I)))
open('brands.json', 'w').write(json.dumps(slugs))
print('Extracted', len(slugs), 'brands')
