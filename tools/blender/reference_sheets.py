"""Renders reference sheets of the Blender figures for image-to-3D tools
(Tripo and similar): front, left, back and right orthographic views plus a
three-quarter hero shot, in the rest pose the game's skeleton is built for,
on a plain background with even lighting and no ground.

Run with Blender's Python module (headless):
    python tools/blender/reference_sheets.py --out assets/source/reference

A generated model that keeps these proportions and this pose can be bound to
the existing skeleton and reuse the Idle, Walk and Attack clips.
"""

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import figures as F  # noqa: E402

TEAMS = {'human_footman': '#2f6fdb', 'orc_grunt': '#c8322b'}
CENTER_Z = 0.56
# Figures face -Y, so the character's left side faces +X.
VIEWS = {
    'front': (0, -1),
    'left': (1, 0),
    'back': (0, 1),
    'right': (-1, 0),
}


def matte_paint():
    mat = bpy.data.materials.new('PaintedPlastic')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.55
    bsdf.inputs['Coat Weight'].default_value = 0.15
    bsdf.inputs['Coat Roughness'].default_value = 0.3
    return mat


def studio(res, samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.8, 0.8, 0.82, 1)
    bg.inputs['Strength'].default_value = 0.9
    # One broad light overhead keeps shading the same from every side.
    bpy.ops.object.light_add(type='AREA', location=(0, 0, 3.2))
    top = bpy.context.active_object
    top.data.energy = 260
    top.data.size = 3.0


def ortho_camera(direction, scale):
    dx, dy = direction
    loc = Vector((dx * 4, dy * 4, CENTER_Z))
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.active_object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    cam.rotation_euler = (Vector((0, 0, CENTER_Z)) - loc).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def hero_camera():
    yaw = math.radians(-32)
    loc = Vector((math.sin(-yaw) * 2.6, -math.cos(yaw) * 2.6, 1.15))
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.active_object
    cam.data.lens = 58
    cam.rotation_euler = (Vector((0, 0, CENTER_Z - 0.02)) - loc).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f'RENDERED {path}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='assets/source/reference')
    ap.add_argument('--res', type=int, default=1024)
    ap.add_argument('--samples', type=int, default=40)
    ap.add_argument('--only', default='')
    args = ap.parse_args(argv)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    for kind, team in TEAMS.items():
        if args.only and kind != args.only:
            continue
        F.clear_scene()
        studio(args.res, args.samples)
        body, arm, _ = F.build(kind, team)
        body.data.materials.append(matte_paint())
        for name, direction in VIEWS.items():
            ortho_camera(direction, 1.45)
            render(os.path.join(out, f'{kind}_{name}.png'))
        hero_camera()
        render(os.path.join(out, f'{kind}_three_quarter.png'))


if __name__ == '__main__':
    main()
