"""Blender review scene for Lan. Run with blender --background --python ... -- ...

This imports real GLB/FBX assets; it never fabricates a replacement character.
Without --model it saves only a clearly labelled reference/preparation scene.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reference', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--model', type=Path)
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    reference = args.reference.resolve(strict=True)
    model = args.model.resolve(strict=True) if args.model else None
    if model and model.suffix.lower() not in ('.glb', '.gltf', '.fbx'):
        parser.error('Model must be GLB, glTF, or FBX')
    if args.render and not model:
        parser.error('--render requires a real model; the reference is not a 3D result')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.render.resolution_x = 960
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world = bpy.data.worlds.new('Soft neutral review lighting')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.72, 0.78, 0.87, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45

    imported = []
    if model:
        if model.suffix.lower() == '.fbx':
            bpy.ops.import_scene.fbx(filepath=str(model))
        else:
            bpy.ops.import_scene.gltf(filepath=str(model))
        imported = list(scene.objects)
        for obj in imported:
            if obj.type in ('CAMERA', 'LIGHT'):
                obj.hide_render = True
        meshes = [obj for obj in imported if obj.type == 'MESH']
        if not meshes:
            raise RuntimeError('Imported file contains no mesh')
        bpy.context.view_layer.update()
        corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
        low = Vector(tuple(min(p[i] for p in corners) for i in range(3)))
        high = Vector(tuple(max(p[i] for p in corners) for i in range(3)))
        height = high.z - low.z
        if height < 1e-6:
            raise RuntimeError('Degenerate model bounds; inspect source axis/geometry')
        # Parent only imported roots. Preserve bone weights, animation, and source file.
        root = bpy.data.objects.new('LAN_REVIEW_NORMALIZATION', None)
        scene.collection.objects.link(root)
        for obj in imported:
            if obj.parent is None:
                obj.parent = root
        scale = 2.0 / height
        root.scale = (scale,) * 3
        root.location = (-(high.x + low.x) * scale / 2,
                         -(high.y + low.y) * scale / 2, -low.z * scale)
        bpy.context.view_layer.update()
        review_width = max(high.x - low.x, high.y - low.y) * scale
    else:
        meshes = []
        review_width = 2.0

    ref = bpy.data.objects.new('B_REFERENCE_ONLY_NOT_A_3D_MODEL', None)
    ref.empty_display_type = 'IMAGE'
    ref.data = bpy.data.images.load(str(reference))
    ref.data.pack()
    ref.empty_display_size = 2
    ref.rotation_euler.x = math.pi / 2
    ref.location = (-3.0, 0, 1)
    scene.collection.objects.link(ref)
    ref['purpose'] = 'Approved B direction front reference; back/side must be visually reviewed.'

    bpy.ops.object.camera_add(location=(0, -6, 1))
    camera = bpy.context.object
    scene.camera = camera
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = max(2.5, review_width * 1.2)
    aim(camera, (0, 0, 1))
    for name, loc, power, size in [('Key', (3, -4, 5), 500, 4),
                                    ('Fill', (-3, -2, 2.5), 250, 3),
                                    ('Rim', (1, 3, 4), 450, 3)]:
        bpy.ops.object.light_add(type='AREA', location=loc)
        light = bpy.context.object
        light.name = name
        light.data.energy = power
        light.data.shape = 'DISK'
        light.data.size = size
        aim(light, (0, 0, 1))

    report = {
        'state': 'imported_model_pending_visual_review' if model else 'reference_preparation_only_no_model',
        'source': str(model) if model else None,
        'reference': str(reference),
        'mesh_objects': len(meshes),
        'vertices': sum(len(obj.data.vertices) for obj in meshes),
        'triangles': 0,
        'armatures': [{'name': obj.name, 'bones': len(obj.data.bones)}
                      for obj in imported if obj.type == 'ARMATURE'],
        'actions': [action.name for action in bpy.data.actions],
        'shape_keys': {obj.name: [key.name for key in obj.data.shape_keys.key_blocks]
                       for obj in meshes if obj.data.shape_keys},
        'images': [{'name': img.name, 'width': img.size[0], 'height': img.size[1],
                    'has_data': img.has_data} for img in bpy.data.images if img != ref.data],
        'limitations': ['Front camera assumes imported Blender -Y facing; inspect all views.',
                        'Mesh/material/bone counts do not establish identity or animation quality.',
                        'No retopology, weight corrections or game integration performed by this script.'],
    }
    for obj in meshes:
        obj.data.calc_loop_triangles()
        report['triangles'] += len(obj.data.loop_triangles)
    note = bpy.data.texts.new('READ_ME_FIRST')
    note.write(json.dumps(report, ensure_ascii=False, indent=2))
    for image in bpy.data.images:
        if image.has_data and image.source == 'FILE':
            image.pack()
    destination = output / ('model-review.blend' if model else 'reference-only.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(destination))
    if args.render:
        for name, loc in [('front', (0, -6, 1)), ('right', (6, 0, 1)),
                          ('back', (0, 6, 1)), ('three-quarter', (4, -6, 2.6))]:
            camera.location = loc
            aim(camera, (0, 0, 1))
            scene.render.filepath = str(output / f'{name}.png')
            bpy.ops.render.render(write_still=True)
    (output / 'inspection.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'blend': str(destination), 'state': report['state']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
