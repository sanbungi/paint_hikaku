module ui.text;

import bindbc.sdl;
import sdl_image;
import std.string : split, strip;
import std.conv : to;

struct Glyph
{
    int x, y, w, h, adv;
}

struct FontAtlas
{
    SDL_Texture* tex;
    Glyph[dchar] glyphs;
    int gw = 28, gh = 32;

    void load(SDL_Renderer* r)
    {
        auto png = cast(ubyte[]) import("font_atlas.png");
        auto rw = SDL_RWFromConstMem(png.ptr, cast(int) png.length);
        auto surf = IMG_Load_RW(rw, 1);
        if (surf is null)
            return;
        tex = SDL_CreateTextureFromSurface(r, surf);
        SDL_FreeSurface(surf);
        if (tex !is null)
            SDL_SetTextureBlendMode(tex, SDL_BLENDMODE_BLEND);
        auto map = import("font_atlas.txt");
        foreach (line; (cast(string) map).split("\n"))
        {
            auto s = line.strip;
            if (!s.length)
                continue;
            auto p = s.split();
            if (p.length < 5)
                continue;
            dchar ch = cast(dchar) to!int(p[0]);
            int adv = p.length >= 6 ? to!int(p[5]) : to!int(p[3]) - 6;
            glyphs[ch] = Glyph(to!int(p[1]), to!int(p[2]), to!int(p[3]), to!int(p[4]), adv);
        }
    }

    void draw(SDL_Renderer* r, string utf8, int x, int y, ubyte cr = 30, ubyte cg = 30, ubyte cb = 32)
    {
        if (tex is null)
            return;
        SDL_SetTextureColorMod(tex, cr, cg, cb);
        SDL_SetTextureAlphaMod(tex, 255);
        import std.utf : byDchar;
        int cx = x;
        foreach (ch; utf8.byDchar)
        {
            if (ch == '\n')
            {
                cx = x;
                y += gh;
                continue;
            }
            auto g = ch in glyphs;
            if (g is null)
            {
                cx += 12;
                continue;
            }
            SDL_Rect src = SDL_Rect(g.x, g.y, g.w, g.h);
            SDL_Rect dst = SDL_Rect(cx, y, g.w, g.h);
            SDL_RenderCopy(r, tex, &src, &dst);
            cx += g.adv;
        }
    }
}
