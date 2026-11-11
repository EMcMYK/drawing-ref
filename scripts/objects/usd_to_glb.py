"""Convert one sand3d USD file to a plain GLB: meshes only, no materials,
textures, cameras, lights or joints. Run with the `bpy` (Blender) module:

    python -I scripts/objects/usd_to_glb.py in.usda out.glb

The USD file is imported as data (no Python from the dataset is executed).
Prints one JSON line with the triangle and part counts.
"""
import json
import sys

import bpy


def main(src, dst):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.usd_import(filepath=src)

    # Keep meshes only.
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        raise SystemExit('no meshes in ' + src)

    tris = 0
    for obj in meshes:
        obj.data.materials.clear()
        mesh = obj.data
        mesh.calc_loop_triangles()
        tris += len(mesh.loop_triangles)

    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        export_materials='NONE',
        export_texcoords=False,
        export_normals=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_apply=True,
        export_yup=True,
    )
    print(json.dumps({'parts': len(meshes), 'triangles': tris}))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
