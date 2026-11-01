"""Repair the downloaded Hunyuan mesh in a separate Blender/GLB batch.

Back-only silhouette corrections and added hair locks; no rig or motion claim.
Coordinates below are fitted to this batch, not a generic character repair tool.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x-a)/(b-a)))
    return t*t*(3-2*t)


def matte(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if shader is None:
        shader = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        output = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(shader.outputs['BSDF'],output.inputs['Surface'])
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .72
    shader.inputs['Specular IOR Level'].default_value = .18
    return mat


def hair_material():
    mat = matte('LAN_blue_hair_gradient', (1, 1, 1))
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    color = nodes.new('ShaderNodeVertexColor')
    color.layer_name = 'Color'
    shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    links.new(color.outputs['Color'], shader.inputs['Base Color'])
    return mat


def strand(index, mat):
    u = index/12
    verts, faces = [], []
    rings, sides = 44, 12
    for ring in range(rings+1):
        t = ring/rings
        spread = .55 + .56*smooth(0, .7, t)
        x = -.22 + (u-.5)*spread
        x += .036*math.sin(t*math.pi*3.2+u*2)*smooth(.1, .8, t)
        start_z = 1.83-.26*(abs(u-.5)*2)**1.5
        end_z = .51+.045*math.cos(index*1.9)
        z = start_z*(1-t)+end_z*t
        y = -.31 + .58*math.sin(t*math.pi*.65)
        y += .025*math.cos(u*math.pi*2)
        width = (.047+.014*math.sin(math.pi*t)) * (.45+.55*(1-t)**.35)
        width *= smooth(0,.18,t)
        width *= min(1, (1-t)*12+.025)
        for side in range(sides):
            angle=side*math.tau/sides
            verts.append((x+width*math.cos(angle), y+.023*math.sin(angle), z))
    for ring in range(rings):
        for side in range(sides):
            a=ring*sides+side
            b=ring*sides+(side+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple(rings*sides+i for i in range(sides)))
    mesh=bpy.data.meshes.new(f'Back_lock_{index:02d}')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj=bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for face in mesh.polygons:
        face.use_smooth=True
    return obj


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    out=args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve(strict=True)))
    original=next(obj for obj in bpy.context.scene.objects if obj.type=='MESH')
    matrix=original.matrix_world.copy()
    for vert in original.data.vertices:
        vert.co=matrix@vert.co
    original.parent=None
    original.matrix_world.identity()
    original.name='Lan_B_hunyuan_back_repaired'
    original.data.update()
    # Tone down the imported exaggerated specular extension on the full mesh.
    for mat in original.data.materials:
        if not mat.use_nodes:
            continue
        shader=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        if shader:
            for socket, value in [('Roughness',.63),('Metallic',0),('Specular IOR Level',.18)]:
                pin=shader.inputs[socket]
                for link in list(pin.links):
                    mat.node_tree.links.remove(link)
                pin.default_value=value
        for node in mat.node_tree.nodes:
            if node.type=='NORMAL_MAP':
                node.inputs['Strength'].default_value=.35
    blue=hair_material()
    original.data.materials.append(blue)
    changed=0
    for face in original.data.polygons:
        c=face.center
        lower=c.y>.06 and .18<c.z<1.5 and -.86<c.x<.42
        crown=c.y>-.21 and 1.38<c.z<1.72 and face.normal.y>.15
        tail=c.z<.46 and c.x>.26
        if (lower or crown) and not tail:
            face.material_index=len(original.data.materials)-1
            changed+=1
    moved=0
    for v in original.data.vertices:
        x,y,z=v.co
        weight=smooth(.04,.2,y)*(1-smooth(1.12,1.48,z))
        weight*=smooth(-.88,-.62,x)*(1-smooth(.24,.44,x))*smooth(.12,.3,z)
        if weight:
            v.co.y-=max(0,y-.04)*.66*weight
            v.co.z+=max(0,.55-z)*weight
            moved+=1
    original.data.update()
    locks=[strand(i,blue) for i in range(13)]
    bpy.ops.object.select_all(action='DESELECT')
    original.select_set(True)
    for obj in locks:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=original
    bpy.ops.object.join()
    colors=original.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for face in original.data.polygons:
        is_hair=original.data.materials[face.material_index]==blue
        for loop_id in face.loop_indices:
            z=original.data.vertices[original.data.loops[loop_id].vertex_index].co.z
            t=smooth(.28,1.7,z)
            colors.data[loop_id].color=tuple(a*(1-t)+b*t for a,b in
                zip((.10,.23,.46,1),(.10,.105,.28,1))) if is_hair else (1,1,1,1)
    original.data.color_attributes.active_color=colors
    # Save a full-density editable repair copy first.
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'lan-b-refined.blend'))
    before=sum(len(p.vertices)-2 for p in original.data.polygons)
    modifier=original.modifiers.new('Room_preview_100k', 'DECIMATE')
    modifier.ratio=min(1.0,100000/before)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    texture_dir=out/'textures'
    texture_dir.mkdir(exist_ok=True)
    for img in list(bpy.data.images):
        if img.has_data and img.size[0]>2048 and img.name!='B-master-v1.png':
            img.scale(2048,2048)
            img.filepath_raw=str(texture_dir/(img.name+'.png'))
            img.file_format='PNG'
            img.save()
            resized=bpy.data.images.load(img.filepath_raw,check_existing=False)
            resized.colorspace_settings.name=img.colorspace_settings.name
            for mat in original.data.materials:
                if mat.use_nodes:
                    for node in mat.node_tree.nodes:
                        if node.type=='TEX_IMAGE' and node.image==img:
                            node.image=resized
    bpy.ops.object.select_all(action='DESELECT')
    original.select_set(True)
    bpy.context.view_layer.objects.active=original
    target=out/'lan-b-room-static.glb'
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,
                              export_image_format='JPEG',export_image_quality=92,
                              export_jpeg_quality=92,export_animations=False)
    original.data.calc_loop_triangles()
    report={'source':str(args.source.resolve()),'output':str(target),
            'recolored_back_faces':changed,'deformed_back_vertices':moved,'added_back_locks':13,
            'triangles_before_decimation':before,'triangles_after_decimation':len(original.data.loop_triangles),
            'file_bytes':target.stat().st_size,
            'state':'static_back_repair_candidate_pending_visual_review',
            'limitations':['No skeleton, facial blendshapes, animation or room integration.',
                           'Back-only repair fitted to this batch; not automatic retopology.']}
    (out/'refinement.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
