"""Builds the toy soldiers of Kingdoms of Plastic in Blender: model, rig,
animations, glTF export and preview renders.

Run with Blender's Python module (headless):
    python tools/blender/figures.py --out assets/models --renders .shots/blender

Two factions, glossy toy-soldier style:
  human_footman.glb   bearded footman: nasal helm, breastplate, tabard, kite shield, longsword
  orc_grunt.glb       hulking grunt: tusks, horned helm, spiked pauldrons, harness, great axe

Each figure is one skinned mesh with vertex colours, rigidly bound to a small
skeleton (hips, torso, head, arms, legs). Team colour is painted pure magenta;
the game swaps it for the owner's colour. Clips: Idle, Walk, Attack.
"""

import argparse
import math
import os
import sys

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector

TEAM = '#ff00ff'
C = {
    'skin': '#e9b48c',
    'skinShade': '#c98f68',
    'hair': '#5b3a22',
    'black': '#18161a',
    'white': '#ece8de',
    'steel': '#b4bac0',
    'steelDark': '#6f757c',
    'iron': '#55595f',
    'gold': '#e2ac2a',
    'leather': '#6a4129',
    'leatherDark': '#45291a',
    'cloth': '#8a7a5c',
    'orc': '#6f8f3a',
    'orcDark': '#4f6a28',
    'tusk': '#f2ead2',
    'horn': '#e6dcc0',
    'eyeRed': '#e0442a',
    'wood': '#7a4e2a',
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_color):
    h = hex_color.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


# ---------------------------------------------------------------------------
# Part helpers. Blender is Z-up; figures face -Y (glTF export turns that into
# +Y up, facing +Z, as the game expects). Every part gets a colour attribute
# and a vertex group naming the bone it rides on.

PARTS = []


def finish(obj, color, bone, bevel=0.0, smooth=True, sharp_angle=40):
    if bevel > 0:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = 'ANGLE'
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    mesh = obj.data
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
        mesh.set_sharp_from_angle(angle=math.radians(sharp_angle))
    attr = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    c = rgba(color)
    for d in attr.data:
        d.color = c
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(mesh.vertices))), 1.0, 'REPLACE')
    PARTS.append(obj)
    return obj


def place(obj, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    obj.location = loc
    obj.rotation_euler = [math.radians(a) for a in rot]
    obj.scale = scale
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)
    return obj


def cube(size, loc, color, bone, bevel=0.015, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1)
    return finish(place(bpy.context.active_object, loc, rot, size), color, bone, bevel=bevel)


def sphere(r, loc, color, bone, scale=(1, 1, 1), seg=20, rings=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings)
    return finish(place(bpy.context.active_object, loc, rot, scale), color, bone)


def cylinder(r, depth, loc, color, bone, rot=(0, 0, 0), seg=18, bevel=0.008, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=seg)
    return finish(place(bpy.context.active_object, loc, rot, scale), color, bone, bevel=bevel)


def cone(r1, r2, depth, loc, color, bone, rot=(0, 0, 0), seg=12, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=seg)
    return finish(place(bpy.context.active_object, loc, rot, scale), color, bone)


def torus(major, minor, loc, color, bone, rot=(0, 0, 0), keep=None, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=24, minor_segments=8)
    o = bpy.context.active_object
    if keep:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context='VERTS')
        bm.to_mesh(o.data)
        bm.free()
    return finish(place(o, loc, rot, scale), color, bone)


def slab(outline, thickness, loc, color, bone, rot=(0, 0, 0), bevel=0.01):
    """A flat plate cut from a 2D outline [(x, z), ...], extruded along Y."""
    mesh = bpy.data.meshes.new('slab')
    bm = bmesh.new()
    verts = [bm.verts.new((x, -thickness / 2, z)) for x, z in outline]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, thickness, 0), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new('slab', mesh)
    bpy.context.collection.objects.link(obj)
    return finish(place(obj, loc, rot), color, bone, bevel=bevel, sharp_angle=30)


def join(name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS:
        o.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = name
    PARTS.clear()
    return body


def held(hand, pitch_deg):
    """Returns a function placing points along a weapon held in `hand`, angled by pitch."""
    d = Matrix.Rotation(math.radians(pitch_deg), 4, 'X') @ Vector((0, 0, 1))

    def along(t, side=0.0):
        p = Vector(hand) + d * t + Vector((side, 0, 0))
        return (p.x, p.y, p.z)

    return along, (pitch_deg, 0, 0)


# ---------------------------------------------------------------------------
# Human footman.

HUMAN_RIG = {
    'hips': 0.44, 'neck': 0.8, 'top': 1.06,
    'shoulder': (0.2, 0.77), 'hand': 0.48, 'hipX': 0.075,
}


def build_human(team=TEAM):
    # Boots and legs: steel greaves over dark hose.
    for side in (-1, 1):
        bone = 'leg.L' if side < 0 else 'leg.R'
        x = side * 0.075
        cube((0.12, 0.2, 0.08), (x, -0.02, 0.04), C['leatherDark'], bone, bevel=0.03)
        cylinder(0.055, 0.2, (x, 0, 0.17), C['steel'], bone, seg=16)
        sphere(0.05, (x, -0.015, 0.29), C['steelDark'], bone, scale=(1, 1, 0.8), seg=14, rings=8)
        cylinder(0.058, 0.16, (x, 0, 0.37), C['iron'], bone, seg=16)
    # Mail skirt, belt and the team tabard.
    cone(0.15, 0.135, 0.13, (0, 0, 0.445), C['steelDark'], 'hips', seg=20)
    cube((0.15, 0.02, 0.2), (0, -0.112, 0.43), team, 'hips', bevel=0.006)
    cube((0.15, 0.02, 0.2), (0, 0.112, 0.43), team, 'hips', bevel=0.006)
    cylinder(0.142, 0.04, (0, 0, 0.515), C['leather'], 'torso', seg=20, scale=(1, 0.72, 1))
    cube((0.05, 0.02, 0.04), (0, -0.104, 0.515), C['gold'], 'torso', bevel=0.006)
    # Breastplate with a team tabard and a white cross over it.
    sphere(0.15, (0, 0, 0.64), C['steel'], 'torso', scale=(1.05, 0.68, 1.05), seg=22, rings=14)
    cube((0.19, 0.02, 0.27), (0, -0.098, 0.64), team, 'torso', bevel=0.01)
    cube((0.04, 0.012, 0.19), (0, -0.11, 0.65), C['white'], 'torso', bevel=0.004)
    cube((0.14, 0.012, 0.04), (0, -0.11, 0.69), C['white'], 'torso', bevel=0.004)
    # Neck, head and a stern bearded face.
    cylinder(0.045, 0.06, (0, 0, 0.8), C['skin'], 'head', seg=12, bevel=0.0)
    sphere(0.092, (0, 0, 0.88), C['skin'], 'head', scale=(0.95, 1.0, 1.08), seg=22, rings=14)
    # A short square beard on the chin and jaw, and a moustache.
    sphere(0.062, (0, -0.045, 0.82), C['hair'], 'head', scale=(1.05, 0.75, 0.72), seg=16, rings=10)
    for side in (-1, 1):
        cube((0.045, 0.02, 0.016), (side * 0.024, -0.09, 0.855), C['hair'], 'head', bevel=0.006, rot=(0, side * 18, 0))
        sphere(0.013, (side * 0.033, -0.084, 0.888), C['black'], 'head', scale=(1, 0.6, 0.9), seg=8, rings=6)
        cube((0.036, 0.012, 0.011), (side * 0.035, -0.087, 0.905), C['hair'], 'head', bevel=0.003, rot=(0, side * -14, 0))
    sphere(0.017, (0, -0.094, 0.872), C['skinShade'], 'head', scale=(0.9, 1.0, 1.25), seg=10, rings=6)
    # Nasal helm with a team plume.
    sphere(0.1, (0, 0, 0.928), C['steel'], 'head', scale=(1.0, 1.04, 0.9), seg=22, rings=12)
    torus(0.1, 0.01, (0, 0, 0.918), C['steelDark'], 'head', scale=(1, 1.04, 1))
    cube((0.014, 0.014, 0.05), (0, -0.103, 0.893), C['steelDark'], 'head', bevel=0.004)
    cube((0.03, 0.15, 0.06), (0, 0.025, 1.035), team, 'head', bevel=0.014, rot=(-12, 0, 0))
    # Pauldrons, arms in mail, steel gauntlets.
    sx, sz = HUMAN_RIG['shoulder']
    for side in (-1, 1):
        bone = 'arm.L' if side < 0 else 'arm.R'
        x = side * sx
        sphere(0.075, (x, 0, sz), C['steel'], bone, scale=(1.05, 1.0, 0.78), seg=18, rings=10)
        torus(0.07, 0.01, (x, 0, sz - 0.03), C['gold'], bone, scale=(1.05, 1, 1))
        cylinder(0.042, 0.2, (x * 1.03, 0, 0.64), C['steelDark'], bone, rot=(0, side * -6, 0), seg=14)
        cylinder(0.048, 0.1, (x * 1.06, -0.005, 0.52), C['steel'], bone, seg=14)
        sphere(0.045, (x * 1.07, -0.012, 0.47), C['steelDark'], bone, seg=14, rings=8)
    # Kite shield on the left arm: team field, white cross, steel boss.
    kite = [(-0.12, 0.13), (0.12, 0.13), (0.125, 0.04), (0.06, -0.12), (0.0, -0.2), (-0.06, -0.12), (-0.125, 0.04)]
    sx2, sy2, sz2 = -0.245, -0.09, 0.53
    slab(kite, 0.03, (sx2, sy2, sz2), team, 'arm.L', bevel=0.012)
    cube((0.032, 0.014, 0.27), (sx2, sy2 - 0.02, sz2 - 0.02), C['white'], 'arm.L', bevel=0.004)
    cube((0.19, 0.014, 0.032), (sx2, sy2 - 0.02, sz2 + 0.05), C['white'], 'arm.L', bevel=0.004)
    sphere(0.026, (sx2, sy2 - 0.03, sz2 + 0.05), C['steel'], 'arm.L', scale=(1, 0.6, 1), seg=12, rings=8)
    # Longsword in the right fist.
    along, rot = held((sx * 1.07, -0.03, 0.47), 62)
    cube((0.04, 0.012, 0.42), along(0.26), C['steel'], 'arm.R', bevel=0.006, rot=rot)
    cone(0.028, 0.0, 0.06, along(0.5), C['steel'], 'arm.R', rot=rot, seg=4)
    cube((0.14, 0.03, 0.024), along(0.04), C['gold'], 'arm.R', bevel=0.008, rot=rot)
    cylinder(0.013, 0.09, along(-0.01), C['leather'], 'arm.R', rot=rot, seg=8, bevel=0.0)
    sphere(0.021, along(-0.065), C['gold'], 'arm.R', seg=10, rings=6)
    return join('HumanFootman')


# ---------------------------------------------------------------------------
# Orc grunt.

ORC_RIG = {
    'hips': 0.38, 'neck': 0.8, 'top': 1.1,
    'shoulder': (0.27, 0.76), 'hand': 0.42, 'hipX': 0.1,
}


def build_orc(team=TEAM):
    # Thick legs, wrapped shins, big bare feet.
    for side in (-1, 1):
        bone = 'leg.L' if side < 0 else 'leg.R'
        x = side * 0.1
        sphere(0.07, (x, -0.035, 0.035), C['orcDark'], bone, scale=(1.05, 1.5, 0.55), seg=14, rings=8)
        cylinder(0.068, 0.18, (x, 0, 0.15), C['leather'], bone, seg=14)
        cylinder(0.078, 0.16, (x, 0, 0.3), C['cloth'], bone, seg=14)
    # Loincloth in team colour, heavy belt with an iron skull-plate buckle.
    cube((0.15, 0.02, 0.22), (0, -0.14, 0.31), team, 'hips', bevel=0.008)
    cube((0.15, 0.02, 0.22), (0, 0.14, 0.31), team, 'hips', bevel=0.008)
    cylinder(0.19, 0.06, (0, 0, 0.42), C['leatherDark'], 'hips', seg=22, scale=(1, 0.76, 1))
    cube((0.08, 0.02, 0.07), (0, -0.148, 0.42), C['iron'], 'hips', bevel=0.012)
    # Barrel chest, bare and green, with a crossed leather harness.
    sphere(0.21, (0, 0.02, 0.6), C['orc'], 'torso', scale=(1.08, 0.78, 0.95), seg=24, rings=14)
    sphere(0.14, (0, -0.04, 0.5), C['orc'], 'torso', scale=(1.1, 1.0, 0.8), seg=18, rings=10)
    for s in (-1, 1):
        cube((0.05, 0.03, 0.46), (0, -0.14, 0.6), C['leather'], 'torso', bevel=0.008, rot=(0, s * 38, 0))
    cylinder(0.03, 0.012, (0, -0.165, 0.6), C['iron'], 'torso', rot=(90, 0, 0), seg=12, bevel=0.0)
    # Head thrust forward: heavy brow, small red eyes, big jaw with tusks, pointed ears.
    hx, hy, hz = 0, -0.07, 0.86
    cylinder(0.06, 0.08, (0, -0.04, 0.8), C['orc'], 'head', seg=12, bevel=0.0)
    sphere(0.1, (hx, hy, hz), C['orc'], 'head', scale=(1.05, 1.0, 0.95), seg=20, rings=12)
    sphere(0.085, (hx, hy - 0.035, hz - 0.055), C['orc'], 'head', scale=(1.25, 0.95, 0.7), seg=18, rings=10)
    cube((0.17, 0.05, 0.035), (hx, hy - 0.08, hz + 0.03), C['orcDark'], 'head', bevel=0.014)
    for side in (-1, 1):
        sphere(0.014, (side * 0.04, hy - 0.093, hz + 0.003), C['eyeRed'], 'head', scale=(1.2, 0.6, 0.8), seg=8, rings=6)
        cone(0.017, 0.0, 0.07, (side * 0.055, hy - 0.11, hz - 0.045), C['tusk'], 'head', rot=(-12, side * 12, 0), seg=8)
        cone(0.03, 0.0, 0.1, (side * 0.115, hy + 0.01, hz + 0.01), C['orc'], 'head', rot=(0, side * -70, 0), seg=8, scale=(1, 0.5, 1))
    cube((0.06, 0.012, 0.012), (hx, hy - 0.122, hz - 0.075), C['black'], 'head', bevel=0.003)
    # Horned iron helmet with a team band.
    sphere(0.105, (hx, hy + 0.01, hz + 0.045), C['iron'], 'head', scale=(1.0, 1.0, 0.75), seg=20, rings=10)
    torus(0.104, 0.009, (hx, hy + 0.01, hz + 0.035), team, 'head')
    for side in (-1, 1):
        start = Vector((side * 0.075, hy + 0.01, hz + 0.09))
        a1 = math.radians(side * 62)
        d1 = Vector((math.sin(a1), 0, math.cos(a1)))
        mid = start + d1 * 0.11
        cone(0.034, 0.017, 0.11, tuple(start + d1 * 0.055), C['horn'], 'head', rot=(0, side * 62, 0), seg=10)
        a2 = math.radians(side * 18)
        d2 = Vector((math.sin(a2), 0, math.cos(a2)))
        cone(0.018, 0.0, 0.09, tuple(mid + d2 * 0.045), C['horn'], 'head', rot=(0, side * 18, 0), seg=10)
    # Massive spiked pauldrons over team cloth; thick green arms with bracers.
    sx, sz = ORC_RIG['shoulder']
    for side in (-1, 1):
        bone = 'arm.L' if side < 0 else 'arm.R'
        x = side * sx
        sphere(0.1, (x, 0.0, sz + 0.01), C['iron'], bone, scale=(1.1, 1.0, 0.75), seg=18, rings=10)
        cone(0.105, 0.075, 0.09, (x, 0, sz - 0.06), team, bone, seg=16, scale=(1.05, 0.95, 1))
        for k, (dx, dz) in enumerate(((0.0, 0.08), (side * 0.06, 0.06), (-side * 0.06, 0.06))):
            cone(0.022, 0.0, 0.08, (x + dx, 0.0, sz + dz), C['steel'], bone, rot=(0, side * (20 + k * 10), 0), seg=8)
        cylinder(0.06, 0.2, (x * 1.02, 0, 0.6), C['orc'], bone, rot=(0, side * -6, 0), seg=14)
        cylinder(0.064, 0.09, (x * 1.04, 0, 0.47), C['leather'], bone, seg=14)
        sphere(0.06, (x * 1.05, -0.015, 0.41), C['orcDark'], bone, seg=14, rings=8)
    # Great axe in the right fist: long haft, double-bitten iron head.
    along, rot = held((sx * 1.05, -0.03, 0.41), 58)
    cylinder(0.018, 0.62, along(0.2), C['wood'], 'arm.R', rot=rot, seg=10, bevel=0.0)
    for t in (0.0, 0.1, 0.38):
        cylinder(0.022, 0.025, along(t), C['leatherDark'], 'arm.R', rot=rot, seg=10, bevel=0.0)
    blade = [(0.0, -0.07), (0.07, -0.11), (0.14, -0.13), (0.17, 0.0), (0.14, 0.13), (0.07, 0.11), (0.0, 0.07)]
    head_at = along(0.44)
    for side in (-1, 1):
        pts = [(side * x, z) for x, z in blade]
        slab(pts, 0.02, head_at, C['steelDark'], 'arm.R', rot=rot, bevel=0.006)
    cone(0.02, 0.0, 0.08, along(0.55), C['steel'], 'arm.R', rot=rot, seg=6)
    return join('OrcGrunt')


# ---------------------------------------------------------------------------
# Rig and animation (shared by both factions; proportions come from the rig dict).

def build_rig(p):
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm = bpy.context.active_object
    arm.name = 'Rig'
    eb = arm.data.edit_bones
    root = eb[0]
    root.name = 'root'
    root.head, root.tail = (0, 0, 0), (0, 0, 0.1)

    def bone(name, head, tail, parent):
        b = eb.new(name)
        b.head, b.tail = head, tail
        b.parent = eb[parent]
        b.roll = 0
        return b

    sx, sz = p['shoulder']
    bone('hips', (0, 0, p['hips']), (0, 0, p['hips'] + 0.1), 'root')
    bone('torso', (0, 0, p['hips'] + 0.06), (0, 0, p['neck']), 'hips')
    bone('head', (0, 0, p['neck']), (0, 0, p['top']), 'torso')
    for side, n in ((-1, 'L'), (1, 'R')):
        bone(f'arm.{n}', (side * sx, 0, sz), (side * sx * 1.07, 0, p['hand']), 'torso')
        bone(f'leg.{n}', (side * p['hipX'], 0, p['hips']), (side * p['hipX'], 0, 0.02), 'hips')
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def bind(body, arm):
    body.parent = arm
    mod = body.modifiers.new('rig', 'ARMATURE')
    mod.object = arm


def make_action(arm, name, frames, keys):
    """keys: {frame: {bone: (rx, ry, rz, lift)}}, degrees; lift raises the hips."""
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    arm.animation_data.action = action
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    for f, pose in sorted(keys.items()):
        for pb in arm.pose.bones:
            rx, ry, rz, lift = pose.get(pb.name, (0, 0, 0, 0))
            pb.rotation_euler = (math.radians(rx), math.radians(ry), math.radians(rz))
            pb.location = (0, lift, 0) if pb.name == 'hips' else (0, 0, 0)
            pb.keyframe_insert('rotation_euler', frame=f)
            pb.keyframe_insert('location', frame=f)
    action.frame_range = (1, frames)
    return action


def build_actions(arm, heavy=False):
    stride = 26 if heavy else 32
    walk = {}
    for i, f in enumerate((1, 7, 13, 19, 25)):
        s = (1, 0, -1, 0, 1)[i]
        bob = (0, 0.018, 0, 0.018, 0)[i]
        walk[f] = {
            'leg.L': (s * stride, 0, 0, 0),
            'leg.R': (-s * stride, 0, 0, 0),
            'arm.L': (-s * 18, 0, 0, 0),
            'arm.R': (s * 22, 0, 0, 0),
            'torso': (8 if heavy else 3, 0, s * (9 if heavy else 5), 0),
            'hips': (0, 0, -s * 3, bob),
            'head': (-6 if heavy else 0, 0, -s * 3, 0),
        }
    lean = 8 if heavy else 0
    idle = {
        1: {'torso': (lean, 0, 0, 0), 'arm.L': (0, 0, 3, 0), 'arm.R': (-8, 0, -3, 0), 'hips': (0, 0, 0, 0)},
        36: {'torso': (lean + 3, 0, 2, 0), 'arm.L': (-5, 0, 6, 0), 'arm.R': (-2, 0, -6, 0), 'head': (4, 0, 8, 0), 'hips': (0, 0, 0, -0.008)},
        72: {'torso': (lean, 0, 0, 0), 'arm.L': (0, 0, 3, 0), 'arm.R': (-8, 0, -3, 0), 'hips': (0, 0, 0, 0)},
    }
    attack = {
        1: {'arm.R': (0, 0, 0, 0), 'torso': (lean, 0, 0, 0)},
        7: {'arm.R': (-165, 0, -15, 0), 'torso': (lean - 10, 0, -22, 0), 'arm.L': (-25, 0, 10, 0), 'head': (-8, 0, 0, 0)},
        12: {'arm.R': (35, 0, 8, 0), 'torso': (lean + 16, 0, 18, 0), 'arm.L': (-10, 0, 0, 0), 'hips': (0, 0, 0, -0.02)},
        20: {'arm.R': (0, 0, 0, 0), 'torso': (lean, 0, 0, 0), 'arm.L': (0, 0, 0, 0)},
    }
    actions = [make_action(arm, 'Idle', 72, idle), make_action(arm, 'Walk', 25, walk), make_action(arm, 'Attack', 20, attack)]
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
    return actions


FACTIONS = {
    'human_footman': (build_human, HUMAN_RIG, False),
    'orc_grunt': (build_orc, ORC_RIG, True),
}


def build(kind, team=TEAM):
    builder, rig, heavy = FACTIONS[kind]
    body = builder(team)
    arm = build_rig(rig)
    bind(body, arm)
    acts = build_actions(arm, heavy)
    return body, arm, acts


# ---------------------------------------------------------------------------
# Export and previews.

def plastic_material():
    mat = bpy.data.materials.new('ToyPlastic')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.34
    bsdf.inputs['Coat Weight'].default_value = 0.5
    bsdf.inputs['Coat Roughness'].default_value = 0.14
    return mat


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export_glb(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_materials='EXPORT',
        export_normals=True,
        export_texcoords=False,
    )


def setup_studio(res):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.68, 0.78, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
    gm = bpy.data.materials.new('Baseplate')
    gm.use_nodes = True
    gb = gm.node_tree.nodes['Principled BSDF']
    gb.inputs['Base Color'].default_value = rgba('#3d8b3f')
    gb.inputs['Roughness'].default_value = 0.5
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    bpy.context.active_object.data.materials.append(gm)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.06, depth=0.04, vertices=16, location=(-3.9, -3.9, 0.02))
    stud = bpy.context.active_object
    stud.data.materials.append(gm)
    for p in stud.data.polygons:
        p.use_smooth = True
    for axis in (0, 1):
        m = stud.modifiers.new(f'array{axis}', 'ARRAY')
        m.count = 40
        m.use_relative_offset = False
        m.use_constant_offset = True
        m.constant_offset_displace = (0.2, 0, 0) if axis == 0 else (0, 0.2, 0)
    for loc, energy, size, rot in (
        ((-2.4, -2.8, 3.4), 560, 2.4, (42, 0, -40)),
        ((2.8, -1.6, 1.8), 140, 3.0, (60, 0, 55)),
        ((0.6, 2.8, 2.6), 300, 1.6, (-50, 0, 170)),
    ):
        bpy.ops.object.light_add(type='AREA', location=loc)
        light = bpy.context.active_object
        light.data.energy = energy
        light.data.size = size
        light.rotation_euler = [math.radians(a) for a in rot]


def camera(loc, target, lens=55):
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.active_object
    cam.data.lens = lens
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam


def pose(arm, action, frame):
    arm.animation_data.action = action
    if hasattr(arm.animation_data, 'action_slot') and action.slots:
        arm.animation_data.action_slot = action.slots[0]
    bpy.context.scene.frame_set(frame)


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='assets/models')
    ap.add_argument('--renders', default='')
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)

    for kind in FACTIONS:
        clear_scene()
        body, arm, _ = build(kind)
        body.data.materials.append(plastic_material())
        path = os.path.join(os.path.abspath(args.out), f'{kind}.glb')
        tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
        export_glb(path)
        print(f'EXPORTED {path} triangles~{tris}')

    if not args.renders:
        return
    out = os.path.abspath(args.renders)
    os.makedirs(out, exist_ok=True)
    clear_scene()
    setup_studio((1280, 860))
    mat = plastic_material()
    figs = []
    for kind, team, x, turn in (('human_footman', '#2f6fdb', -0.36, 28), ('orc_grunt', '#c8322b', 0.38, -32)):
        body, arm, acts = build(kind, team)
        body.data.materials.append(mat)
        arm.location.x = x
        arm.rotation_euler = (0, 0, math.radians(turn))
        figs.append((arm, acts))
    pose(figs[0][0], figs[0][1][0], 36)
    pose(figs[1][0], figs[1][1][2], 8)
    camera((0.0, -2.35, 1.25), (0, 0, 0.55), lens=52)
    render(os.path.join(out, 'factions_face_off.png'))
    # The same pair from the game's high camera, mid-stride.
    pose(figs[0][0], figs[0][1][1], 4)
    pose(figs[1][0], figs[1][1][1], 16)
    camera((0.0, -2.2, 2.9), (0, 0, 0.35), lens=48)
    render(os.path.join(out, 'factions_game_angle.png'))


if __name__ == '__main__':
    main()
