"""Read pinned original slide relationships; never open or resave it in Office."""
import json, posixpath, sys, zipfile
from xml.etree import ElementTree as ET

with zipfile.ZipFile(sys.argv[1]) as package:
    presentation = ET.fromstring(package.read('ppt/presentation.xml'))
    namespace = presentation.tag.split('}')[0][1:]
    if namespace not in ('http://schemas.openxmlformats.org/presentationml/2006/main',
                         'http://purl.oclc.org/ooxml/presentationml/main'):
        raise ValueError('Unknown presentation namespace')
    relationships = {r.attrib['Id']: r for r in ET.fromstring(package.read('ppt/_rels/presentation.xml.rels'))}
    size = presentation.find('{%s}sldSz' % namespace)
    if size is None:
        raise ValueError('Missing native slide dimensions')
    slides = []
    for number, entry in enumerate(presentation.find('{%s}sldIdLst' % namespace), 1):
        relation_id = next(v for k, v in entry.attrib.items() if k.endswith('}id'))
        relation = relationships[relation_id]
        if relation.attrib.get('TargetMode') == 'External' or not relation.attrib['Type'].endswith('/slide'):
            raise ValueError('Slide relationship is not an internal slide')
        target = relation.attrib['Target']
        part = target.lstrip('/') if target.startswith('/') else posixpath.normpath('ppt/' + target)
        if not part.startswith('ppt/slides/') or part not in package.namelist():
            raise ValueError('Invalid slide relationship target')
        root = ET.fromstring(package.read(part))
        slides.append({'number': number, 'pptxSlideId': entry.attrib['id'], 'relationshipId': relation_id,
                       'part': part, 'hidden': root.attrib.get('show') in ('0', 'false'),
                       'hasAuthoredTiming': any(e.tag.endswith('}timing') for e in root.iter()),
                       'hasAuthoredTransition': any(e.tag.endswith('}transition') for e in root.iter())})
    if not slides or len({s['pptxSlideId'] for s in slides}) != len(slides):
        raise ValueError('Empty or duplicate original slide identifiers')
    print(json.dumps({'sizeEMU': {'cx': int(size.attrib['cx']), 'cy': int(size.attrib['cy'])}, 'slides': slides}))
