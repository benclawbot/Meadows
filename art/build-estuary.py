"""Sculpt First Light, export its game meshes and render the Blender world as a sky panorama."""
import argparse
from bisect import bisect_right
import json
import math as m
import random
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector, noise


parser = argparse.ArgumentParser()
parser.add_argument("--seed", type=Path, required=True)
parser.add_argument("--references", type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--blend", type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
args.out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
rng = random.Random(463875)


def collection(name):
    result = bpy.data.collections.new(name)
    scene.collection.children.link(result)
    return result


land = collection("First Light • terrain and water")
features = collection("First Light • coast landmarks")
kit = collection("Botanical and stone masters")
studio = collection("Sun and cameras")
game_objects = []


def material(name, color, roughness=.86, vertex=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    if vertex:
        vertex_color = mat.node_tree.nodes.new("ShaderNodeVertexColor")
        vertex_color.layer_name = "Tint"
        mat.node_tree.links.new(vertex_color.outputs["Color"], shader.inputs["Base Color"])
    return mat


def image(name, size=None, data=False, output_name=None):
    path = args.references / name
    texture = bpy.data.images.load(str(path), check_existing=True)
    if data:
        texture.colorspace_settings.name = "Non-Color"
    if size:
        texture.scale(size, size)
        texture.file_format = "JPEG"
        texture.filepath_raw = str(args.out / (output_name or ("packed-" + name)))
        texture.save(quality=90)
        texture.pack()
    return texture


def surface(name, diffuse, normal, normal_strength):
    mat = material(name, (.19, .21, .12))
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get("Principled BSDF")
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.image = image(diffuse, 768)
    relief = nodes.new("ShaderNodeTexImage")
    relief.image = image(normal, 768, data=True)
    bump = nodes.new("ShaderNodeNormalMap")
    bump.inputs["Strength"].default_value = normal_strength
    links.new(albedo.outputs["Color"], shader.inputs["Base Color"])
    links.new(relief.outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return mat


def save_texture(name, pixels, data=False):
    height, width, _ = pixels.shape
    texture = bpy.data.images.new(name, width, height, alpha=False, is_data=data)
    texture.pixels.foreach_set(pixels.astype(np.float32).ravel())
    texture.file_format = "PNG" if name.endswith(".png") else "JPEG"
    texture.filepath_raw = str(args.out / name)
    texture.save(quality=92)
    texture.pack()
    return texture


def image_pixels(texture):
    width, height = texture.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    texture.pixels.foreach_get(pixels)
    return pixels.reshape(height, width, 4)


soil = surface("Photographed meadow turf", "turf-photo.jpg", "turf-normal.jpg", .52)
stone = surface("Eroded coastal sandstone", "stone-albedo-source.jpg", "stone-normal-source.jpg", .77)
leaves = material("Meadow leaf and reed tint", (.17, .25, .07), vertex=True)
pine = material("Salt-stunted pine • bark and needles", (.14, .11, .04), vertex=True)
corolla = material("Petal tissue", (.81, .55, .21), .58)
riverbed = image("riverbed-photo.jpg", 768, output_name="riverbed.jpg")
shore_sand = image("wet-sand-photo.jpg", 768, output_name="shore-sand.jpg")

leaf_photo = image_pixels(image("leaf-photo.jpg"))
blade_photo = save_texture("blade.jpg", leaf_photo[548:765, 841:854].copy())
bark_photo = image_pixels(image("bark-photo.jpg", 512))
bark = np.ones((512, 576, 4), dtype=np.float32)
bark[:, :512] = bark_photo
bark_atlas = save_texture("pine-bark.jpg", bark)
bark_relief = np.full((512, 576, 4), (.5, .5, 1, 1), dtype=np.float32)
bark_relief[:, :512] = image_pixels(image("bark-normal.jpg", 512, data=True))
bark_normal = save_texture("pine-normal.jpg", bark_relief, data=True)


def mix_photograph(mat, photograph):
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = photograph
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1
    links.new(shader.inputs["Base Color"].links[0].from_socket, multiply.inputs[1])
    links.new(tex.outputs["Color"], multiply.inputs[2])
    links.new(multiply.outputs["Color"], shader.inputs["Base Color"])


def object_mesh(name, vertices, faces, mat, parent_collection, colors=None, uvs=None):
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    if colors:
        attr = mesh.color_attributes.new(name="Tint", type="FLOAT_COLOR", domain="POINT")
        attr.data.foreach_set("color", [value for color in colors for value in (*color, 1)])
    if uvs:
        uv = mesh.uv_layers.new(name="Coastal surface")
        uv.uv.foreach_set("vector", [value for loop in mesh.loops for value in uvs[loop.vertex_index]])
    for face in mesh.polygons:
        face.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    parent_collection.objects.link(obj)
    mesh.materials.append(mat)
    return obj


def add_tube(vertices, faces, colors, points, radii, sides, base):
    first = len(vertices)
    points = [Vector(co) for co in points]
    for j, (point, radius) in enumerate(zip(points, radii)):
        axis = (points[min(j + 1, len(points) - 1)] - points[max(j - 1, 0)]).normalized()
        side = axis.cross(Vector((0, 1, 0))).normalized() if abs(axis.y) < .92 else axis.cross(Vector((1, 0, 0))).normalized()
        up = axis.cross(side).normalized()
        for k in range(sides):
            angle = k * m.tau / sides
            radius_here = radius * rng.uniform(.88, 1.13)
            vertices.append(point + (side * m.cos(angle) + up * m.sin(angle)) * radius_here)
            colors.append(tuple(c * rng.uniform(.75, 1.32) for c in base))
    for j in range(len(points) - 1):
        for k in range(sides):
            a = first + j * sides + k
            b = first + j * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.append(tuple(first + k for k in reversed(range(sides))))
    faces.append(tuple(first + (len(points) - 1) * sides + k for k in range(sides)))


def blade(vertices, faces, colors, root, angle, height, width, bow, color, uvs=None):
    start = len(vertices)
    across = Vector((m.cos(angle), m.sin(angle), 0))
    forward = Vector((-m.sin(angle), m.cos(angle), 0))
    root = Vector(root)
    for t, taper in [(0, .56), (.19, 1), (.45, .84), (.72, .48), (1, .022)]:
        center = root + forward * (bow * t ** 1.7)
        center.z += height * (t - .16 * t ** 4)
        for sign in (-1, 1):
            shade = .59 + t * .55 + sign * .045
            vertices.append(center + across * (sign * width * taper))
            colors.append(tuple(c * shade for c in color))
            if uvs is not None:
                uvs.append((.5 + sign * .43, t))
    for index in range(start, start + 8, 2):
        faces.append((index, index + 1, index + 3, index + 2))


def grass():
    vertices, faces, colors, uvs = [], [], [], []
    for i in range(7):
        angle = i * 2.39996 + rng.uniform(-.24, .24)
        root = (rng.uniform(-.105, .105), rng.uniform(-.11, .11), 0)
        blade(vertices, faces, colors, root, angle, rng.uniform(.47, 1.13),
              rng.uniform(.023, .037), rng.uniform(.14, .53), (rng.uniform(.065, .13), .29, .035), uvs)
    for i in range(2):
        start = len(vertices)
        x, y = rng.uniform(-.15, .16), rng.uniform(-.14, .14)
        height = rng.uniform(1.04, 1.28)
        for t, w in [(0, .007), (.54, .008), (.88, .025), (1, .002)]:
            for sign in (-1, 1):
                vertices.append((x + sign * w + t * t * .18, y + t * t * .21, height * t))
                colors.append((.52, .28, .057) if t > .7 else (.055, .23, .024))
                uvs.append((.5 + sign * .43, t))
        for j in range(start, start + 6, 2):
            faces.append((j, j + 1, j + 3, j + 2))
    return object_mesh("FescueTuft", vertices, faces, leaves, kit, colors, uvs)


def reed():
    vertices, faces, colors = [], [], []
    for i in range(11):
        blade(vertices, faces, colors, (rng.uniform(-.2, .2), rng.uniform(-.2, .2), 0),
              i * 2.39996, rng.uniform(.7, 1.64), rng.uniform(.028, .066), rng.uniform(.26, .68),
              (rng.uniform(.095, .18), rng.uniform(.22, .37), .038))
    for stem in range(5):
        x, y = rng.uniform(-.24, .25), rng.uniform(-.20, .24)
        h = rng.uniform(1.19, 1.89)
        add_tube(vertices, faces, colors, ((x, y, 0), (x + .06, y, h * .64), (x + .16, y, h)),
                 (.018, .014, .009), 6, (.12, .20, .034))
        add_tube(vertices, faces, colors, ((x + .14, y, h * .94), (x + .16, y, h),
                 (x + .22, y, h + .12), (x + .23, y, h + .17)),
                 (.034, .054, .045, .012), 8, (.19, .070, .019))
    return object_mesh("CattailStand", vertices, faces, leaves, kit, colors)


def weathered_rock(name, profile):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=1)
    obj = bpy.context.object
    for parent in list(obj.users_collection):
        parent.objects.unlink(obj)
    kit.objects.link(obj)
    obj.name = name
    obj.data.materials.append(stone)
    for vert in obj.data.vertices:
        p = vert.co.copy()
        grain = noise.fractal(p * 4.8 + Vector((3.7, 8.1, profile)), 1.0, 2.05, 3)
        fault = m.sin(23 * p.z + 2.2 * p.x + 2.2 * grain)
        shape = p * (.89 + .15 * grain + .053 * fault)
        shape.x += shape.z * (.17 + profile * .14)
        shape.y += .16 * shape.x ** 2
        shape.z = max(-.38, min(.74 + .11 * shape.x - profile * .06, shape.z * (.75 + profile * .18)))
        vert.co = shape
    uv = obj.data.uv_layers.new(name="Bedded stone")
    for face in obj.data.polygons:
        face.use_smooth = True
        normal = face.normal
        for j in face.loop_indices:
            p = obj.data.vertices[obj.data.loops[j].vertex_index].co
            uv.data[j].uv = ((p.x + p.y * normal.x * .67) * .65,
                              (p.z * (1 - abs(normal.z)) + p.y * normal.z) * .67)
    return obj


def wind_pine(name, lean):
    vertices, faces, colors = [], [], []
    trunk = [(0, 0, -.12), (-.08, .04, 1.06), (.12, .10, 2.15),
             (.48 * lean, .12, 3.24), (1.04 * lean, -.14, 4.20),
             (1.72 * lean, -.25, 5.14), (2.37 * lean, -.31, 5.70)]
    add_tube(vertices, faces, colors, trunk, (.35, .27, .218, .152, .102, .065, .014), 10, (.66, .47, .34))
    for j in range(21):
        i = 1 + j % 5
        root = Vector(trunk[i]).lerp(Vector(trunk[i + 1]), rng.uniform(.09, .87))
        azimuth = j * 2.39996
        direction = Vector((m.cos(azimuth), m.sin(azimuth), .14)).normalized()
        reach = (4.75 - root.z * .48) * rng.uniform(.44, .94)
        tip = root + direction * reach + Vector((lean * .87, -.02, .39))
        fork = root.lerp(tip, .55) + Vector((-.17 * lean, .03, -.14))
        add_tube(vertices, faces, colors, (root, fork, tip), (.083, .048, .005), 6, (.64, .43, .28))
        for k in range(8):
            start = fork.lerp(tip, (k + 1) / 9)
            end = start + Vector((lean * .35 + rng.uniform(-.28, .42), rng.uniform(-.68, .68),
                                  rng.uniform(.06, .59)))
            add_tube(vertices, faces, colors, (start, end), (.025, .004), 4, (.56, .39, .25))
            for _ in range(17):
                center = start.lerp(end, rng.uniform(.15, 1))
                spread = Vector((rng.uniform(-.31, .43), rng.uniform(-.40, .40), rng.uniform(-.13, .28)))
                forward = (end - start + spread * 3).normalized()
                cross = forward.cross(Vector((0, 0, 1))).normalized() * rng.uniform(.014, .029)
                a = len(vertices)
                vertices.extend((center - cross, center + cross, center + forward * rng.uniform(.17, .38)))
                shade = rng.uniform(.51, 1.37)
                colors.extend(((.026*shade, .082*shade, .015*shade), (.033*shade, .112*shade, .021*shade),
                               (.065*shade, .19*shade, .037*shade)))
                faces.append((a, a + 1, a + 2))
    uvs = [(0.96, .5) if green > red else (.02 + ((point[0]*.73 + point[1]*.48) % 1) * .83, point[2]*1.3)
           for point, (red, green, _) in zip(vertices, colors)]
    return object_mesh(name, vertices, faces, pine, kit, colors, uvs)


def petal():
    vertices, faces, uvs = [], [], []
    for j in range(10):
        t = j / 9
        for i in range(7):
            edge = (i - 3) / 3
            width = (.17 + .73 * m.sin(m.pi * (.13 + .80*t))) * (1 - .21*t)
            vertices.append((edge * width + .075*t*t, t*2-1, .77*edge*edge + .52*(t-.59)**2 + .11*m.sin(t*8+edge*3)))
            uvs.append((i / 6, t))
    for j in range(9):
        for i in range(6):
            a = j*7+i
            faces.append((a, a+1, a+8, a+7))
    return object_mesh("WildflowerPetal", vertices, faces, corolla, kit, uvs=uvs)


seed = json.loads(args.seed.read_text())
xs, zs = seed["x"], seed["z"]
heights = []
verts, faces = [], []


def hill(x, z, cx, cz, width, depth, strength):
    return strength * m.exp(-(((x - cx) / width) ** 2 + ((z - cz) / depth) ** 2))


for row, z in enumerate(zs):
    for col, x in enumerate(xs):
        index = row * len(xs) + col
        y = seed["elevation"][index]
        distance = min(1, max(0, max(abs(x) - 48, -z - 128) / 27))
        if distance and 2 <= col < len(xs) - 2 and 2 <= row < len(zs) - 2:
            rounded = sum(seed["elevation"][index + dz * len(xs) + dx]
                          for dx, dz in [(-2, 0), (2, 0), (0, -2), (0, 2)]) / 4
            y += (rounded - y) * distance * .65
        folds = hill(x, z, -17, -33, 13, 22, 2.42) + hill(x, z, -23, -70, 20, 27, 1.53)
        cut = hill(x, z, 25, -52, 13, 14, 1.92) + hill(x, z, 15, -27, 7, 22, .84)
        banks = hill(x, z, 9, -23, 8, 23, .80) + hill(x, z, 37, -72, 13, 22, 1.47)
        high = y + folds + banks - cut
        detail = hill(x, z, -8, -62, 57, 89, .29)
        high += detail * noise.fractal(Vector((x*.27, z*.27, 30.45)), 1.0, 2.1, 3)
        height_mm = round(high * 1000)
        heights.append(height_mm)
        verts.append((x, -z, height_mm / 1000))
        if row and col:
            d, c = index, index - 1
            b, a = index - len(xs), index - len(xs) - 1
            faces.extend(((a, c, b), (b, c, d)))

terrain = object_mesh("FirstLightTerrain", verts, faces, soil, land,
                      uvs=[(x / 3.55, -z / 3.55) for z in zs for x in xs])
game_objects.append(terrain)
(args.out / "first-light.json").write_text(json.dumps({"x": xs, "z": zs, "mm": heights}, separators=(",", ":")))


def elevation(x, z):
    i = max(0, min(len(xs) - 2, bisect_right(xs, x) - 1))
    j = max(0, min(len(zs) - 2, bisect_right(zs, z) - 1))
    u, v = (x-xs[i])/(xs[i+1]-xs[i]), (z-zs[j])/(zs[j+1]-zs[j])
    a, b = (heights[j*len(xs)+i+k] / 1000 for k in (0, 1))
    c, d = (heights[(j+1)*len(xs)+i+k] / 1000 for k in (0, 1))
    return a+(b-a)*u+(c-a)*v if u+v <= 1 else d+(c-d)*(1-u)+(b-d)*(1-v)


def linked(name, master, x, z, scale, yaw, sink=.04):
    obj = bpy.data.objects.new(name, master.data)
    features.objects.link(obj)
    obj.location = (x, -z, max(-1.42, elevation(x, z)) - sink)
    obj.scale = scale
    obj.rotation_euler[2] = yaw
    return obj


tuft, reeds = grass(), reed()
block = weathered_rock("RoundedShoreRock", 0)
shelf = weathered_rock("LayeredShoreRock", 1)
pine_a, pine_b = wind_pine("WindPineWest", 1), wind_pine("WindPineEast", -.77)
petal_master = petal()
game_objects.extend((tuft, reeds, block, shelf, pine_a, pine_b, petal_master))
for index, (x, z, scale, yaw) in enumerate([
    (-12.6, -25.4, 1.42, -.15), (-17.9, -29.5, 1.11, 1.12), (-21.8, -32.7, .90, -.77),
    (-23.5, -40.8, 1.25, .27), (-19.5, -36, .88, .67), (-29, -52, .87, -1.24),
    (36, -67, 1.06, 1.6), (39, -71, .81, .5), (43, -75, 1.26, -.5),
    (-38, -95, 1.16, .4), (-45, -102, .88, -.9), (-48, -112, 1.2, .9),
]):
    game_objects.append(linked(f"EstuaryPine_{index:02}", pine_a if index % 3 else pine_b, x, z, (scale,)*3, yaw, .18))

for i, z0 in enumerate(range(-195, 50, 16)):
    for j, x0 in enumerate(range(-135, 131, 17)):
        x, z = x0 + rng.uniform(-5.5, 5.5), z0 + rng.uniform(-5.5, 5.5)
        y = elevation(x, z)
        grade = m.hypot(elevation(x+1, z)-y, elevation(x, z+1)-y)
        if y < .42 or grade > .92 or rng.random() < .57:
            continue
        if any((x-cx)**2+(z-cz)**2 < radius**2 for cx, cz, radius in seed["clearings"]):
            continue
        scale = rng.uniform(.51, 1.26)
        yaw = rng.uniform(-m.pi, m.pi)
        game_objects.append(linked(f"EstuaryPineScatter_{i:02}_{j:02}", pine_a if (i+j)%2 else pine_b,
                                   x, z, (scale, scale, scale*rng.uniform(.9, 1.13)), yaw, .15))
for index, (x, z, size, height, width, yaw) in enumerate([
    (5.7, 1, 1.35, .71, .86, .3), (-5.6, -6.8, 1.29, .78, 1.28, -.7),
    (-10.7, -19, 2.72, 1.51, 1.52, .24), (-15.3, -23, 2.82, 1.72, 1.82, .57),
    (-17, -26.5, 2.85, 2.05, 3.57, -.58), (-16.8, -29.3, 3.85, 1.7, 2.95, .56),
    (9.8, -19, 1.51, .81, 1.80, -.32), (13, -20.7, 1.92, 1.26, 1.48, 1.6),
    (30, -53, 2.42, 1.9, 2.77, .75), (32.1, -54.8, 2.65, 1.21, 3.43, -.55),
    (39, -75, 4.12, 2.31, 4.11, .68), (40.1, -86, 4.91, 2.85, 5.6, -.7),
    (5, -119, 3.8, 2.88, 4.45, .2), (12, -130, 4.1, 6.5, 4.36, -.4),
    (18, -139, 3.26, 4.55, 3.22, .48), (22, -146, 4.2, 3.9, 3.8, -.2),
]):
    game_objects.append(linked(f"EstuaryLedge_{index:02}", shelf if index % 3 else block,
                               x, z, (size, width, height), yaw, .10))
for index in range(227):
    z = rng.uniform(-158, 29)
    center = 23 + 16*m.sin((z+11)*.041) - .108*z
    width = 2.6 + 2.4*(1+m.sin(z*.042+.8)) + 9*max(0,(-z-66)/130)
    x = center + rng.choice((-1, 1)) * width * rng.uniform(.82, 1.60)
    if -.5 < elevation(x, z) < .97:
        size = rng.uniform(.46, .97)
        game_objects.append(linked(f"EstuaryReeds_{index:02}", reeds, x, z, (size,)*3, rng.uniform(-m.pi,m.pi)))

for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in game_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = terrain
bpy.ops.export_scene.gltf(filepath=str(args.out / "first-light.glb"), export_format="GLB",
                          use_selection=True, export_image_format="JPEG", export_image_quality=89)
mix_photograph(pine, bark_atlas)
pine_nodes, pine_links = pine.node_tree.nodes, pine.node_tree.links
bark_texture = pine_nodes.new("ShaderNodeTexImage")
bark_texture.image = bark_normal
bark_detail = pine_nodes.new("ShaderNodeNormalMap")
bark_detail.inputs["Strength"].default_value = .58
pine_links.new(bark_texture.outputs["Color"], bark_detail.inputs["Color"])
pine_links.new(bark_detail.outputs["Normal"], pine_nodes.get("Principled BSDF").inputs["Normal"])
fescue_surface = leaves.copy()
fescue_surface.name = "Photographed fescue blades"
mix_photograph(fescue_surface, blade_photo)
tuft.data.materials[0] = fescue_surface

soil_nodes, soil_links = soil.node_tree.nodes, soil.node_tree.links
soil_input = soil_nodes.get("Principled BSDF").inputs["Base Color"]
turf_color = soil_input.links[0].from_socket
proximity = soil_nodes.new("ShaderNodeMapRange")
proximity.inputs["From Min"].default_value = -.67
proximity.inputs["From Max"].default_value = .46
coordinates = soil_nodes.new("ShaderNodeNewGeometry")
height_axis = soil_nodes.new("ShaderNodeSeparateXYZ")
soil_links.new(coordinates.outputs["Position"], height_axis.inputs["Vector"])
soil_links.new(height_axis.outputs["Z"], proximity.inputs["Value"])
sediment = soil_nodes.new("ShaderNodeMixRGB")
sediment.inputs[0].default_value = .52
for index, photograph in enumerate([riverbed, shore_sand], 1):
    image_node = soil_nodes.new("ShaderNodeTexImage")
    image_node.image = photograph
    soil_links.new(image_node.outputs["Color"], sediment.inputs[index])
shoreline = soil_nodes.new("ShaderNodeMixRGB")
soil_links.new(proximity.outputs["Result"], shoreline.inputs[0])
soil_links.new(sediment.outputs["Color"], shoreline.inputs[1])
soil_links.new(turf_color, shoreline.inputs[2])
soil_links.new(shoreline.outputs["Color"], soil_input)
for obj in game_objects:
    obj.select_set(False)
for obj in kit.objects:
    obj.hide_render = True
    obj.hide_set(True)


def scatter_fescue():
    points = []
    for _ in range(106000):
        x, z = rng.uniform(xs[0], xs[-1]), rng.uniform(zs[0], zs[-1])
        y = elevation(x, z)
        if y > -.42 and m.hypot(elevation(x+.7, z)-y, elevation(x, z+.7)-y) < .88:
            points.append((x, -z, y - .03))
    mesh = bpy.data.meshes.new("Fescue roots")
    mesh.from_pydata(points, [], [])
    roots = bpy.data.objects.new("Meadow fescue", mesh)
    features.objects.link(roots)
    group = bpy.data.node_groups.new("Fescue on dry banks", "GeometryNodeTree")
    group.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nodes, links = group.nodes, group.links
    entry = nodes.new("NodeGroupInput")
    source = nodes.new("GeometryNodeObjectInfo")
    source.inputs["Object"].default_value = tuft
    source.inputs["As Instance"].default_value = True
    scatter = nodes.new("GeometryNodeInstanceOnPoints")
    size = nodes.new("FunctionNodeRandomValue")
    size.data_type = "FLOAT"
    for socket in size.inputs:
        if socket.enabled and socket.name in {"Min", "Max"}:
            socket.default_value = .45 if socket.name == "Min" else 1.22
    rotation = nodes.new("FunctionNodeRandomValue")
    rotation.data_type = "FLOAT_VECTOR"
    rotation.inputs["Max"].default_value = (0, 0, m.tau)
    exit_node = nodes.new("NodeGroupOutput")
    links.new(entry.outputs["Geometry"], scatter.inputs["Points"])
    links.new(source.outputs["Geometry"], scatter.inputs["Instance"])
    links.new(next(socket for socket in size.outputs if socket.enabled), scatter.inputs["Scale"])
    links.new(rotation.outputs["Value"], scatter.inputs["Rotation"])
    links.new(scatter.outputs["Instances"], exit_node.inputs["Geometry"])
    roots.modifiers.new("Varied fescue on the estuary floor", "NODES").node_group = group


scatter_fescue()

sky_photo = bpy.data.images.load(str(args.references / "coast-sky.hdr"))
world = bpy.data.worlds.new("Coastal sky • sun, clouds and sea haze")
world.use_nodes = True
nodes, links = world.node_tree.nodes, world.node_tree.links
background = nodes.get("Background")
background.inputs["Strength"].default_value = .78
sky = nodes.new("ShaderNodeTexSky")
sky.sky_type = "NISHITA"
sky.sun_elevation = m.radians(14)
sky.sun_rotation = m.radians(126)
sky.sun_disc = False
sky.air_density = 1.05
sky.dust_density = .85
environment = nodes.new("ShaderNodeTexEnvironment")
environment.image = sky_photo
mix = nodes.new("ShaderNodeMixRGB")
mix.label = "Warm coastal haze over the physical sky"
mix.inputs[0].default_value = .88
links.new(sky.outputs["Color"], mix.inputs[1])
links.new(environment.outputs["Color"], mix.inputs[2])

clouds = nodes.new("ShaderNodeTexEnvironment")
clouds.image = bpy.data.images.load(str(args.references / "day-sky.hdr"))
direction = nodes.new("ShaderNodeTexCoord")
map_clouds = nodes.new("ShaderNodeMapping")
map_clouds.vector_type = "POINT"
map_clouds.inputs["Location"].default_value[2] = .565
map_clouds.inputs["Scale"].default_value[2] = 2.09
links.new(direction.outputs["Generated"], map_clouds.inputs["Vector"])
links.new(map_clouds.outputs["Vector"], clouds.inputs["Vector"])
cloud_light = nodes.new("ShaderNodeMixRGB")
cloud_light.blend_type = "MULTIPLY"
cloud_light.inputs[0].default_value = 1
cloud_light.inputs[2].default_value = (1.15, .93, .78, 1)
links.new(clouds.outputs["Color"], cloud_light.inputs[1])
sky_layers = nodes.new("ShaderNodeMixRGB")
sky_layers.label = "Broken cloud lit from the east"
sky_layers.inputs[0].default_value = .73
links.new(mix.outputs["Color"], sky_layers.inputs[1])
links.new(cloud_light.outputs["Color"], sky_layers.inputs[2])
links.new(sky_layers.outputs["Color"], background.inputs["Color"])
scene.world = world
scene.view_settings.view_transform = "AgX"
scene.render.engine = "CYCLES"
scene.cycles.samples = 12


def camera(name, where, look_at):
    camera_data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, camera_data)
    studio.objects.link(obj)
    obj.location = where
    obj.rotation_euler = (Vector(look_at)-obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def bake_tidal_normals():
    ocean = object_mesh("Tidal ripple source", [(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)],
                        [(0, 1, 2, 3)], soil, kit)
    waves = ocean.modifiers.new("Shallow-water spectrum", "OCEAN")
    waves.spectrum = "TEXEL_MARSEN_ARSLOE"
    waves.viewport_resolution = waves.resolution = 16
    waves.spatial_size = 19
    waves.depth = 2.5
    waves.wind_velocity = 6.0
    waves.wave_scale_min = .046
    waves.wave_alignment = .42
    waves.choppiness = 0
    waves.fetch_jonswap = 210
    waves.time = 3.4
    waves.random_seed = 8462
    evaluated = ocean.evaluated_get(bpy.context.evaluated_depsgraph_get())
    grid = evaluated.to_mesh()
    coords = np.empty(len(grid.vertices) * 3, dtype=np.float32)
    grid.vertices.foreach_get("co", coords)
    evaluated.to_mesh_clear()
    ocean.hide_render = True
    ocean.hide_set(True)
    pts = coords.reshape(-1, 3)
    side = m.isqrt(len(pts))
    assert side * side == len(pts) and side >= 65
    grid = pts[np.lexsort((pts[:, 0], pts[:, 1])), 2].reshape(side, side)[:-1, :-1]
    slopes = np.stack([(np.roll(grid, 1, axis) - np.roll(grid, -1, axis)) for axis in (1, 0)], axis=-1)
    extent = np.percentile(np.linalg.norm(slopes, axis=-1), 98)
    assert extent > 1e-6, "The tidal bake has no measurable slopes"
    slopes = np.clip(slopes * (.29 / extent), -.58, .58)
    pixels = np.ones((*grid.shape, 4), dtype=np.float32)
    pixels[..., :2] = slopes * .5 + .5
    pixels[..., 2] = np.sqrt(1 - np.sum(slopes ** 2, axis=-1)) * .5 + .5
    return save_texture("tidal-normals.png", pixels, data=True)


lookout = camera("Look into First Light", (7.6, -15.3, 5.6), (1.9, 28, 1.8))
lookout.data.lens = 32
lookout.data.clip_end = 850
sun_data = bpy.data.lights.new("Sun over the estuary", "SUN")
sun_data.energy = 2.35
sun_data.color = (1.0, .78, .51)
sun_data.angle = m.radians(5)
sun = bpy.data.objects.new("Sun over the estuary", sun_data)
studio.objects.link(sun)
sun.rotation_euler = Vector((-.56, -.82, -.38)).to_track_quat("-Z", "Y").to_euler()
water = material("Estuary • shallow tidal water", (.018, .135, .123), .11)
water_nodes, water_links = water.node_tree.nodes, water.node_tree.links
shader = water_nodes.get("Principled BSDF")
shader.inputs["IOR"].default_value = 1.333
shader.inputs["Transmission Weight"].default_value = .92
ripples = water_nodes.new("ShaderNodeTexImage")
ripples.image = bake_tidal_normals()
normal = water_nodes.new("ShaderNodeNormalMap")
normal.inputs["Strength"].default_value = .58
water_links.new(ripples.outputs["Color"], normal.inputs["Color"])
water_links.new(normal.outputs["Normal"], shader.inputs["Normal"])
object_mesh("Tidewater", [(-450, -320, -.57), (450, -320, -.57), (450, 670, -.57), (-450, 670, -.57)],
            [(0, 1, 2, 3)], water, land, uvs=[(-75, -54), (75, -54), (75, 112), (-75, 112)])

# Render from a separate scene so the sky texture contains no terrain or vegetation.
panorama = bpy.data.scenes.new("Sky panorama")
panorama.world = world
panorama.render.engine = "CYCLES"
panorama.cycles.samples = 2
panorama.view_settings.view_transform = "AgX"
panorama.view_settings.exposure = -.84
cam_data = bpy.data.cameras.new("Equirectangular sky")
cam_data.type = "PANO"
cam_data.panorama_type = "EQUIRECTANGULAR"
cam = bpy.data.objects.new("Equirectangular sky", cam_data)
panorama.collection.objects.link(cam)
cam.rotation_euler[0] = m.pi / 2
panorama.camera = cam
panorama.render.resolution_x = 2048
panorama.render.resolution_y = 1024
panorama.render.resolution_percentage = 100
panorama.render.image_settings.file_format = "JPEG"
panorama.render.image_settings.quality = 92
panorama.render.filepath = str(args.out / "blender-sky.jpg")
bpy.ops.render.render(write_still=True, scene=panorama.name)

scene.camera = lookout
scene.render.resolution_x = 1600
scene.render.resolution_y = 900
for area in bpy.context.screen.areas:
    if area.type == "VIEW_3D":
        area.spaces.active.region_3d.view_perspective = "CAMERA"
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(args.blend), compress=True)
