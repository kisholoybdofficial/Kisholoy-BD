import math
import struct
import zlib
import os

def create_png(width, height, get_pixel_func):
    """Generates an RGBA PNG buffer using a pixel callback (x, y) -> (r, g, b, a)."""
    raw_rows = []
    for y in range(height):
        row = bytearray([0]) # filter type 0 (None)
        for x in range(width):
            r, g, b, a = get_pixel_func(x, y, width, height)
            row.extend((r, g, b, a))
        raw_rows.append(bytes(row))
    
    compressed = zlib.compress(b''.join(raw_rows), 9)
    
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = zlib.crc32(c) & 0xffffffff
        return struct.pack('>I', len(data)) + c + struct.pack('>I', crc)
    
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    return png

def dist_segment(px, py, x1, y1, x2, y2):
    """Distance from point (px, py) to line segment (x1, y1)-(x2, y2)."""
    dx = x2 - x1
    dy = y2 - y1
    l2 = dx*dx + dy*dy
    if l2 == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1)*dx + (py - y1)*dy) / l2))
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy
    return math.hypot(px - proj_x, py - proj_y)

def make_kisholoy_icon(width, height, is_maskable=False):
    # Normalized coordinates 0..1
    # Brand Colors
    # Background: #083732 (8, 55, 50)
    # Emerald green arc: #34d399 (52, 211, 153)
    # Rose dot: #f43f5e (244, 63, 94)
    # White monogram: #f8fafc (248, 250, 252)
    # Terracotta dot: #fb923c (251, 146, 60)
    
    bg_color = (8, 55, 50, 255)
    emerald = (52, 211, 153, 255)
    rose = (244, 63, 94, 255)
    white = (248, 250, 252, 255)
    terracotta = (251, 146, 60, 255)
    
    # Rounded corner radius for standard icons, full bleed for maskable
    corner_radius = 0.0 if is_maskable else 0.22
    
    # Scale content: for maskable icons, keep within 0.70 of canvas (safe zone)
    content_scale = 0.68 if is_maskable else 0.82
    center_x = 0.5
    center_y = 0.5
    
    def pixel(x, y, w, h):
        nx = x / (w - 1.0)
        ny = y / (h - 1.0)
        
        # Check rounded rect boundary for non-maskable
        if not is_maskable:
            # Check corners
            r = corner_radius
            dx = 0.0
            dy = 0.0
            if nx < r:
                dx = r - nx
            elif nx > 1.0 - r:
                dx = nx - (1.0 - r)
            if ny < r:
                dy = r - ny
            elif ny > 1.0 - r:
                dy = ny - (1.0 - r)
            if dx > 0 and dy > 0:
                dist = math.hypot(dx, dy)
                if dist > r:
                    # Antialiased transparent border
                    alpha = max(0.0, min(1.0, 1.0 - (dist - r) * min(w, h)))
                    if alpha == 0:
                        return (0, 0, 0, 0)
        
        # Map (nx, ny) to SVG local glyph coordinates
        # SVG viewport is 120x120. In SVG:
        # group translate(18, 14) scale(0.38)
        # Center of SVG is roughly (60, 60).
        gx = (nx - center_x) / content_scale * 120.0 + 60.0
        gy = (ny - center_y) / content_scale * 120.0 + 60.0
        
        # In group space:
        # gx = 18 + 0.38 * lx  =>  lx = (gx - 18) / 0.38
        # gy = 14 + 0.38 * ly  =>  ly = (gy - 14) / 0.38
        lx = (gx - 18.0) / 0.38
        ly = (gy - 14.0) / 0.38
        
        # Check botanical elements
        # 1. Rose circle at (30, 106) r=16
        if math.hypot(lx - 30.0, ly - 106.0) <= 17.0:
            return rose
        
        # 2. Terracotta circle at (204, 174) r=22
        if math.hypot(lx - 204.0, ly - 174.0) <= 23.0:
            return terracotta
        
        # 3. Emerald Arc: path d="M 40 100 A 70 70 0 0 1 180 84" stroke-width 24
        # Arc center roughly at (110, 150), radius approx 70
        arc_dx = lx - 110.0
        arc_dy = ly - 150.0
        arc_r = math.hypot(arc_dx, arc_dy)
        if 57.0 <= arc_r <= 83.0 and ly <= 112.0 and 35.0 <= lx <= 185.0:
            return emerald
        
        # 4. Monogram stem, bar, loop (white lines with stroke width ~24, so radius 12)
        sw = 12.5
        # Bar: line (74, 96) to (204, 96)
        if dist_segment(lx, ly, 74.0, 96.0, 204.0, 96.0) <= sw:
            return white
        # Stem: line (74, 90) to (74, 210)
        if dist_segment(lx, ly, 74.0, 90.0, 74.0, 210.0) <= sw:
            return white
        # Stem bottom hook: (74, 210) to (104, 240) to (124, 240)
        if dist_segment(lx, ly, 74.0, 210.0, 104.0, 240.0) <= sw or dist_segment(lx, ly, 104.0, 240.0, 124.0, 240.0) <= sw:
            return white
        # Loop: approximate center at (146, 146) with radius ~32
        loop_r = math.hypot(lx - 146.0, ly - 146.0)
        if 20.0 <= loop_r <= 44.0 and lx >= 110.0:
            return white
        # Leg: (166, 150) to (196, 240)
        if dist_segment(lx, ly, 166.0, 150.0, 196.0, 240.0) <= sw:
            return white
            
        return bg_color

    return create_png(width, height, pixel)

def main():
    os.makedirs('public', exist_ok=True)
    
    print("Generating pwa-192x192.png...")
    png_192 = make_kisholoy_icon(192, 192, is_maskable=False)
    with open('public/pwa-192x192.png', 'wb') as f:
        f.write(png_192)
        
    print("Generating pwa-512x512.png...")
    png_512 = make_kisholoy_icon(512, 512, is_maskable=False)
    with open('public/pwa-512x512.png', 'wb') as f:
        f.write(png_512)
        
    print("Generating pwa-maskable-512x512.png...")
    png_maskable = make_kisholoy_icon(512, 512, is_maskable=True)
    with open('public/pwa-maskable-512x512.png', 'wb') as f:
        f.write(png_maskable)
        
    print("Generating apple-touch-icon.png...")
    png_apple = make_kisholoy_icon(180, 180, is_maskable=False)
    with open('public/apple-touch-icon.png', 'wb') as f:
        f.write(png_apple)
        
    print("Generating favicon.ico...")
    png_64 = make_kisholoy_icon(64, 64, is_maskable=False)
    with open('public/favicon.ico', 'wb') as f:
        f.write(png_64)

    print("All PWA icons generated successfully!")

if __name__ == '__main__':
    main()
