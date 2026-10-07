"""
Generate crisp, professional RGBA PNG icons for OmniAccess AI extension.
Uses standard library struct and zlib - zero external dependencies required.
"""
import zlib
import struct
import os
import math

def draw_omniaccess_icon(size):
    # RGBA format
    raw_data = bytearray()
    scale = size / 128.0
    
    # Coordinates normalized to 128x128
    # Head: center (64, 30), r = 11
    # Torso: vertical line from (64, 44) to (64, 82), stroke = 12
    # Arms: arc / horizontal bar (32, 54) to (96, 54), stroke = 11
    # Legs: from (64, 80) to (44, 108) and (84, 108), stroke = 11
    # Halo / Signal wave arc: r = 54 around (64, 64)
    
    for y in range(size):
        raw_data.append(0)  # filter type 0
        ny = y / scale
        for x in range(size):
            nx = x / scale
            
            # Distance from center
            cdx = nx - 64
            cdy = ny - 64
            center_dist = math.sqrt(cdx * cdx + cdy * cdy)
            
            # Background circular badge with smooth edge
            badge_r = 60.0
            if center_dist > badge_r + 1.0:
                raw_data.extend([0, 0, 0, 0])  # transparent
                continue
            
            # Badge gradient: from royal indigo #3B82F6 to #1D4ED8 to #0F172A
            t = (ny / 128.0)
            bg_r = int(29 * (1 - t) + 15 * t)
            bg_g = int(78 * (1 - t) + 23 * t)
            bg_b = int(216 * (1 - t) + 42 * t)
            
            # Antialiasing alpha on outer border
            badge_alpha = 255
            if center_dist > badge_r - 1.0:
                badge_alpha = int(255 * max(0.0, min(1.0, (badge_r + 1.0 - center_dist) / 2.0)))
            
            # Check if (nx, ny) is inside accessibility symbol (head, arms, torso, legs, sensor wave)
            is_symbol = False
            
            # Head (circle at 64, 32, radius 10)
            hdx = nx - 64
            hdy = ny - 32
            if math.sqrt(hdx*hdx + hdy*hdy) <= 10.5:
                is_symbol = True
                
            # Torso (pill from 64, 46 to 64, 80, width 12)
            if 44 <= ny <= 82 and abs(nx - 64) <= 6.0:
                is_symbol = True
                
            # Arms (curved wings / horizontal bar from x=30 to x=98, y=52, width 11)
            arm_dy = ny - (50 + 4 * (1 - ((nx - 64)/34)**2) if abs(nx - 64) <= 34 else 50)
            if abs(nx - 64) <= 36 and abs(arm_dy) <= 5.5:
                is_symbol = True
                
            # Left leg (line from 64, 78 to 44, 108, width 9)
            # Parametric line check
            for leg_dir in [-1, 1]:
                lx1, ly1 = 64, 76
                lx2, ly2 = 64 + leg_dir * 22, 106
                # Distance to segment
                dx, dy = lx2 - lx1, ly2 - ly1
                l2 = dx*dx + dy*dy
                t_seg = max(0, min(1, ((nx - lx1)*dx + (ny - ly1)*dy) / l2))
                px = lx1 + t_seg * dx
                py = ly1 + t_seg * dy
                dist_leg = math.sqrt((nx - px)**2 + (ny - py)**2)
                if dist_leg <= 5.5:
                    is_symbol = True
                    break
                    
            # Sensory ring / signal wave arc at top left & top right
            if (50 <= center_dist <= 57) and (cdy < -10 or abs(cdx) > 35):
                is_symbol = True

            if is_symbol:
                # White symbol #FFFFFF with soft highlight
                raw_data.extend([255, 255, 255, badge_alpha])
            else:
                raw_data.extend([bg_r, bg_g, bg_b, badge_alpha])
                
    compressor = zlib.compressobj(level=9)
    compressed = compressor.compress(raw_data) + compressor.flush()
    
    png = bytearray(b'\x89PNG\r\n\x1a\n')
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0) # 6 = RGBA
    png.extend(struct.pack('>I', 13))
    png.extend(b'IHDR')
    png.extend(ihdr)
    png.extend(struct.pack('>I', zlib.crc32(b'IHDR' + ihdr)))
    
    png.extend(struct.pack('>I', len(compressed)))
    png.extend(b'IDAT')
    png.extend(compressed)
    png.extend(struct.pack('>I', zlib.crc32(b'IDAT' + compressed)))
    
    png.extend(struct.pack('>I', 0))
    png.extend(b'IEND')
    png.extend(struct.pack('>I', zlib.crc32(b'IEND')))
    return png

def main():
    os.makedirs('icons', exist_ok=True)
    for size in [16, 48, 128]:
        png_data = draw_omniaccess_icon(size)
        path = f'icons/icon-{size}.png'
        with open(path, 'wb') as f:
            f.write(png_data)
        print(f"Generated {path} ({size}x{size}px, {len(png_data)} bytes)")

if __name__ == '__main__':
    main()
