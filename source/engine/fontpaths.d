module engine.fontpaths;

import std.file : exists;

/// CJK フォント候補。dlangui 既定の Arial/DejaVu だけだと日本語が豆腐になる。
string[] cjkFontCandidates()
{
    return [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
        "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
        "C:\\Windows\\Fonts\\YuGothM.ttc",
        "C:\\Windows\\Fonts\\meiryo.ttc",
        "C:\\Windows\\Fonts\\msgothic.ttc",
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\NotoSansCJK-Regular.ttc",
    ];
}

string firstExistingCjkFont()
{
    foreach (p; cjkFontCandidates())
        if (exists(p))
            return p;
    return null;
}

unittest
{
    auto list = cjkFontCandidates();
    assert(list.length >= 4);
    bool hasNoto, hasDroid, hasWin;
    foreach (p; list)
    {
        if (p.length >= 4 && p[$ - 4 .. $] == ".ttc" && (p.length > 20))
        {
        }
        import std.algorithm : canFind;
        if (p.canFind("NotoSansCJK"))
            hasNoto = true;
        if (p.canFind("DroidSansFallback"))
            hasDroid = true;
        if (p.canFind("Windows"))
            hasWin = true;
    }
    assert(hasNoto && hasDroid && hasWin);
}
