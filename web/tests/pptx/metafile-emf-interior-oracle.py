import struct,zipfile,json,sys
D=zipfile.ZipFile(sys.argv[1]).read('ppt/media/image1.emf')
points=[(100,250),(100,150),(150,250),(200,250),(300,150),(320,50),(450,150),(500,250),(40,200),(400,100)]
colors=[(0,0,0,0)]*len(points);objects={};state={'brush':(0xffffff,0),'clips':[]};stack=[];bounds=struct.unpack_from('<4i',D,8);o=0
stock={0:(0xffffff,0),1:(0xc0c0c0,0),2:(0x808080,0),3:(0x404040,0),4:(0,0),5:(0,1)}
def inside(x,y,pts):
 result=False
 for k in range(len(pts)):
  a,b=pts[k-1],pts[k]
  if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:result=not result
 return result
while o<len(D):
 t,n=struct.unpack_from('<II',D,o)
 if t==39:
  h,style,col,hatch=struct.unpack_from('<4I',D,o+8);objects[h]=(col,style)
 elif t==38:objects[struct.unpack_from('<I',D,o+8)[0]]=None
 elif t==82:objects[struct.unpack_from('<I',D,o+8)[0]]=None
 elif t==37:
  h=struct.unpack_from('<I',D,o+8)[0];obj=stock.get(h&0x7fffffff) if h&0x80000000 else objects[h]
  if obj is not None:state['brush']=obj
 elif t==40:objects.pop(struct.unpack_from('<I',D,o+8)[0])
 elif t==33:stack.append({'brush':state['brush'],'clips':list(state['clips'])})
 elif t==34:state=stack.pop()
 elif t in [29,30]:state['clips'].append((t,struct.unpack_from('<4i',D,o+8)))
 elif t in [43,86]:
  if t==43:
   l,tp,r,b=struct.unpack_from('<4i',D,o+8);poly=[(l,tp),(r,tp),(r,b),(l,b)]
  else:k=struct.unpack_from('<I',D,o+24)[0];poly=list(struct.iter_unpack('<hh',D[o+28:o+28+k*4]))
  if state['brush'][1]==0:
   col=state['brush'][0];rgba=(col&255,col>>8&255,col>>16&255,255)
   for index,p in enumerate(points):
    x,y=p[0]+bounds[0]+.5,p[1]+bounds[1]+.5
    allowed=all(((l<=x<r and tp<=y<b) if mode==30 else not(l<=x<r and tp<=y<b)) for mode,(l,tp,r,b) in state['clips'])
    if allowed and inside(x,y,poly):colors[index]=rgba
 o+=n
print(json.dumps({'points':points,'expected':colors,'oracle':'Independent binary reader + ray-crossing polygon fill + DC rectangle clipping. Samples exclude glyph/outline pixels; not PowerPoint reference.'},indent=2))
