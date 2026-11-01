"""Build a separate 200k/2K soft-material preview. Preserve raw GLB; no rigging."""
import bpy,json
from pathlib import Path
root=Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'lan-b-multiview-original.glb'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
report={'source':'lan-b-multiview-original.glb','target_triangles':200000,'texture_max':2048,'roughness':0.55,'metallic':0.0,'rigged':False,'changes':[]}
for mat in bpy.data.materials:
 if not mat.use_nodes: continue
 for node in mat.node_tree.nodes:
  if node.type!='BSDF_PRINCIPLED':continue
  for key,value in [('Roughness',.55),('Metallic',0.0)]:
   for link in list(node.inputs[key].links): mat.node_tree.links.remove(link)
   node.inputs[key].default_value=value
  node.inputs['Specular IOR Level'].default_value=.32
for img in list(bpy.data.images):
 if img.source!='FILE':continue
 _=img.pixels[0] if len(img.pixels) else None
 if not img.has_data or max(img.size)<=2048:continue
 original_name=img.name
 img.scale(2048,2048)
 img.filepath_raw=str(root/(original_name.replace('/','_')+'-2k.png'))
 img.file_format='PNG';img.save()
 resized=bpy.data.images.load(img.filepath_raw,check_existing=False)
 resized.colorspace_settings.name=img.colorspace_settings.name
 for mat in bpy.data.materials:
  if mat.use_nodes:
   for node in mat.node_tree.nodes:
    if node.type=='TEX_IMAGE' and node.image==img:node.image=resized
for obj in meshes:
 obj.data.calc_loop_triangles();before=len(obj.data.loop_triangles)
 bpy.context.view_layer.objects.active=obj
 modifier=obj.modifiers.new('Game copy triangle reduction','DECIMATE');modifier.ratio=min(1.0,200000/before)
 bpy.ops.object.modifier_apply(modifier=modifier.name)
 obj.data.calc_loop_triangles()
 report['changes'].append({'mesh':obj.name,'before_triangles':before,'after_triangles':len(obj.data.loop_triangles)})
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:obj.select_set(True)
target=root/'lan-b-multiview-game-preview.glb'
bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_image_format='JPEG',export_image_quality=92,export_jpeg_quality=92,export_animations=False)
report['bytes']=target.stat().st_size
report['limitations']=['No skeleton, animations or face shape keys.','Decimation is not deformation-ready retopology.','Preview requires visual review before use.']
(root/'game-copy-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
