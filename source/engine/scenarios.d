module engine.scenarios;

version (unittest):
import engine.session;
import engine.types;
import engine.raster;
import engine.templates;
import engine.perspective;
import engine.compare;
import engine.grid;
import store.history;
import std.exception : enforce;
import std.stdio : writeln;

void scenario(string id, void delegate() run)
{
    writeln("RUN ", id);
    run();
    writeln("PASS ", id);
}

void expectPixels(string id, const(ubyte)[] actual, const(ubyte)[] expected, int width, int height)
{
    if (actual == expected) return;
    import std.file : mkdirRecurse;
    import std.path : buildPath;
    import std.process : environment;
    import arsd.png : writePng, PngType;
    auto output = environment.get("PAINT_HIKAKU_TEST_OUTPUT", "test-results");
    mkdirRecurse(output);
    if (actual.length == expected.length)
    {
        auto difference = new ubyte[actual.length];
        foreach (i; 0 .. actual.length)
            difference[i] = i % 4 == 3 ? 255 : (actual[i] == expected[i] ? 0 : 255);
        writePng(buildPath(output, id ~ "-actual.png"), actual, width, height, PngType.truecolor_with_alpha);
        writePng(buildPath(output, id ~ "-expected.png"), expected, width, height, PngType.truecolor_with_alpha);
        writePng(buildPath(output, id ~ "-diff.png"), difference, width, height, PngType.truecolor_with_alpha);
    }
    assert(false, id ~ ": unexpected pixels (see test-results)");
}

unittest
{
    scenario("STATE-SAVE", {
        auto s = new PracticeSession;
        SessionRecord[] records;
        s.writeRecord = (SessionRecord r) { records ~= r; };
        s.timestamp = () => "20260101T000000Z";
        s.select("circle");
        assert(!s.save());
        s.board.addPoint(100, 100, 1);
        s.board.addPoint(150, 100, 1);
        s.check();
        assert(s.save());
        s.check();
        assert(!s.save() && records.length == 1);
        auto ink = s.board.user.px.dup;
        s.setAlignment(AlignMode.centroid);
        assert(!s.saved && s.save());
        assert(records[1].alignMode == "centroid");
        assert(s.board.user.px == ink);
        s.board.overlay = OverlayMode.heat;
        assert(!s.save());
        s.clear();
        assert(!s.board.resultMode && !s.saved);
    });
    scenario("STATE-SAVE-RETRY", {
        auto s = new PracticeSession;
        s.select("circle"); s.check();
        s.writeRecord = (SessionRecord r) { throw new Exception("disk full"); };
        bool failed;
        try s.save(); catch (Exception e) failed = true;
        assert(failed && !s.saved);
        s.writeRecord = (SessionRecord r) {};
        assert(s.save());
    });
    scenario("STATE-IMAGE-PERSPECTIVE", {
        auto s = new PracticeSession;
        auto image = renderBuiltin("circle", CanvasSize, 3);
        auto pixels = composeSample(image, Mask(CanvasSize, CanvasSize));
        s.setTemplate("image:C:\\絵\\sample.png", image, Mask(CanvasSize, CanvasSize), pixels);
        s.board.addPoint(80, 80, 1);
        auto before = s.board.user.px.dup;
        PerspSettings p; p.dist = 1;
        s.adjustPerspective(p);
        assert(s.board.tpl.px == image.px && s.board.tplColor == pixels);
        assert(s.board.user.px == before);
    });
    scenario("STATE-PEEK", {
        auto s = new PracticeSession;
        s.memory(true);
        assert(!s.board.sampleVisible);
        auto first = s.peek(), second = s.peek();
        s.expirePeek(first);
        assert(s.board.sampleVisible);
        s.expirePeek(second);
        assert(!s.board.sampleVisible);
        auto stale = s.peek();
        s.select("circle");
        assert(!s.board.sampleVisible);
        auto active = s.peek();
        s.expirePeek(stale);
        assert(s.board.sampleVisible);
        s.expirePeek(active);
        s.check(); assert(s.board.sampleVisible);
        s.clear(); assert(!s.board.sampleVisible);
    });
    scenario("CATALOG-PERSPECTIVE", {
        foreach (t; builtinCatalog())
        foreach (mode; [PerspMode.onePoint, PerspMode.twoPoint, PerspMode.threePoint, PerspMode.isometric])
        foreach (distance; [1, 55, 90])
        {
            PerspSettings p; p.mode = mode; p.dist = distance;
            auto r = renderTemplate(t.id, p, 96);
            assert(r.ink.px.length == 96 * 96, t.id);
            // At the closest distance the camera may be inside the object.
            if (distance == 55) assert(maskCentroid(r.ink).count > 0, t.id);
        }
    });
    scenario("GUIDES-NONSCORING", {
        auto s = new PracticeSession;
        s.select("circle");
        auto ink = s.board.tpl.px.dup;
        foreach (n; [0, 2, 3, 4])
        {
            auto g = practiceGuides(CanvasSize, n, s.board.tpl, true);
            assert(s.board.tpl.px == ink);
            assert(compareMasks(s.board.tpl, s.board.tpl).iou == 1);
        }
    });
    scenario("HISTORY-PATHS", {
        import std.file : tempDir, mkdirRecurse, rmdirRecurse, write, dirEntries, SpanMode;
        import std.path : buildPath, baseName;
        import std.uuid : randomUUID;
        auto root = buildPath(tempDir(), "paint-hikaku-test-" ~ randomUUID().toString);
        mkdirRecurse(root);
        scope(exit) rmdirRecurse(root);
        SessionRecord r;
        r.isoTime = "2026-01-01T00:00:00Z";
        r.templateId = "image:C:\\日本語 folder\\image.png";
        r.alignMode = "none";
        saveSession(r, root); saveSession(r, root);
        auto records = loadRecent(24, root);
        assert(records.length == 2);
        assert(records[0].templateId == r.templateId);
        foreach (e; dirEntries(root, "*.json", SpanMode.shallow))
            foreach (c; baseName(e.name)) assert(c != ':' && c != '\\');
        write(buildPath(root, "broken.json"), "{");
        write(buildPath(root, "legacy.json"), `{"isoTime":"old","templateId":"circle","alignMode":"none","metrics":{"iou":0.5}}`);
        assert(loadRecent(24, root).length == 3);
    });
    scenario("COMPARE-PIXELS", {
        auto t = Mask(4, 1), u = Mask(4, 1);
        t.at(0, 0) = 255; t.at(1, 0) = 255;
        u.at(1, 0) = 255; u.at(2, 0) = 255;
        auto rgba = composeOverlay(t, u, OverlayMode.overlay);
        immutable ubyte[] expected = [50,90,210,255, 40,170,90,255,
            210,60,70,255, 245,245,242,255];
        expectPixels("COMPARE-PIXELS", rgba, expected, 4, 1);
        auto diff = composeOverlay(t, u, OverlayMode.diff);
        assert(diff[0 .. 4] == [40,80,200,255]);
        assert(diff[8 .. 12] == [220,40,40,255]);
        float[] distances = [0, 0, 24, 48];
        auto heat = composeOverlay(t, u, OverlayMode.heat, distances);
        assert(heat[4 .. 8] == [40,180,50,255]);
        assert(heat[8 .. 12] == [240,20,50,255]);
        auto met = compareMasks(t, u);
        import std.math : abs, isFinite;
        assert(abs(met.iou - 1.0f / 3) < 0.00001);
        assert(met.missRate == 0.5 && met.extraRate == 0.5);
        auto empty = compareMasks(t, Mask(4, 1));
        assert(empty.iou == 0 && empty.missRate == 1 && isFinite(empty.dx));
        auto wide = Mask(10, 1); wide.px[] = 255;
        auto zero = composeWipe(wide, wide, Mask(10, 1), 0);
        auto full = composeWipe(wide, wide, Mask(10, 1), 100);
        assert(zero[16 .. 20] == [200,50,60,255]);
        assert(full[16 .. 20] == [50,90,210,255]);
    });
    scenario("STATE-PERSPECTIVE-GUIDES", {
        auto s = new PracticeSession;
        s.select("solid_cube");
        s.board.addPoint(90, 90, 1); s.check();
        s.writeRecord = (SessionRecord r) {};
        s.save();
        auto ink = s.board.user.px.dup;
        auto p = s.perspective;
        p.showGuides = !p.showGuides;
        p.showHidden = !p.showHidden;
        s.adjustPerspective(p);
        assert(s.saved && s.board.resultMode);
        p.yawDeg += 20;
        s.adjustPerspective(p);
        assert(!s.saved && !s.board.resultMode && s.board.user.px == ink);
    });
}
