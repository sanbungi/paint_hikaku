module app;

import dlangui;
import dlangui.dialogs.filedlg;
import dlangui.dialogs.dialog;
import dlangui.graphics.images;
import dlangui.widgets.groupbox;
import dlangui.widgets.scrollbar;
import ui.canvas;
import ui.fonts;
import engine.types;
import engine.templates;
import engine.perspective;
import engine.solids;
import engine.diagnose;
import engine.raster;
import store.history;
import std.conv : to;
import std.format : format;
import std.array : join;
import std.algorithm : min, max;

mixin APP_ENTRY_POINT;

extern (C) int UIAppMain(string[] args)
{
    installUiFonts();
    auto win = Platform.instance.createWindow("paint_hikaku", null, WindowFlag.Resizable, 1480, 1000);
    auto studio = new Studio();
    win.mainWidget = studio;
    win.show();
    if (args.length > 1)
        studio.openImagePath(args[1]);
    return Platform.instance.enterMessageLoop();
}

final class Studio : VerticalLayout
{
    BoardState board;
    BoardView sampleView;
    BoardView paperView;
    SliderWidget slWipe;
    TextWidget labWipe;
    StringListWidget tplList;
    StringListWidget histList;
    ComboBox overlayCombo;
    CheckBox alignBox;
    EditBox diagText;
    TextWidget status;
    Button btnCheck, btnAgain, btnSave, btnUndo, btnClear;
    TemplateDef[] catalog;
    string templateId = "circle";
    bool savedThisResult;
    SessionRecord[] recs;
    PerspSettings persp;
    ComboBox perspMode;
    SliderWidget slYaw, slPitch, slDist, slHorizon;
    TextWidget labYaw, labPitch, labDist, labHorizon;
    CheckBox chkGuides, chkHidden;

    this()
    {
        super("studio");
        layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);
        padding(Rect(8, 8, 8, 8));
        fontFace = "AppUI";
        fontSize = makePointSize(11);
        catalog = builtinCatalog();

        auto bar = new HorizontalLayout();
        bar.layoutWidth(FILL_PARENT);
        btnUndo = new Button("undo", "アンドゥ"d);
        btnClear = new Button("clear", "クリア"d);
        btnCheck = new Button("check", "答え合わせ"d);
        btnAgain = new Button("again", "もう一度"d);
        btnSave = new Button("save", "記録"d);
        auto btnOpen = new Button("open", "画像を開く…"d);
        auto btnSample = new Button("sample", "サンプル画像"d);
        btnUndo.click = delegate(Widget w) { board.undo(); savedThisResult = false; refreshBoards(); updateDiagLive(); return true; };
        btnClear.click = delegate(Widget w) { board.clearInk(); savedThisResult = false; refreshBoards(); updateDiagLive(); return true; };
        btnCheck.click = delegate(Widget w) { doCheck(); return true; };
        btnAgain.click = delegate(Widget w) { board.clearInk(); savedThisResult = false; refreshBoards(); updateDiagLive(); return true; };
        btnSave.click = delegate(Widget w) { persist(); return true; };
        btnOpen.click = delegate(Widget w) { openFileDlg(); return true; };
        btnSample.click = delegate(Widget w) { loadEmbeddedSample(); return true; };
        bar.addChild(btnUndo);
        bar.addChild(btnClear);
        bar.addChild(btnCheck);
        bar.addChild(btnAgain);
        bar.addChild(btnSave);
        bar.addChild(new HSpacer());
        bar.addChild(btnOpen);
        bar.addChild(btnSample);
        addChild(bar);

        auto body = new HorizontalLayout();
        body.layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);

        auto left = new VerticalLayout();
        left.minWidth = 240;
        left.maxWidth = 280;
        left.layoutHeight(FILL_PARENT);
        left.addChild(new TextWidget(null, "お手本"d).fontSize(18));
        dstring[] names;
        foreach (t; catalog)
            names ~= to!dstring(t.labelJa);
        names ~= "サンプル画像"d;
        auto tplCombo = new ComboBox("tplCombo", names);
        tplCombo.layoutWidth(FILL_PARENT);
        tplCombo.itemClick = delegate(Widget src, int index) {
            applyTemplateIndex(index);
            return true;
        };
        left.addChild(tplCombo);
        tplList = new StringListWidget("tpls", names);
        tplList.layoutWidth(FILL_PARENT).layoutHeight(280);
        tplList.itemSelected = delegate(Widget src, int index) {
            applyTemplateIndex(index);
            return true;
        };
        tplList.itemClick = delegate(Widget src, int index) {
            applyTemplateIndex(index);
            return true;
        };
        left.addChild(tplList);

        auto pg = new GroupBox("perspBox", UIString.fromRaw("パース設定"d));
        pg.layoutWidth(FILL_PARENT);
        perspMode = new ComboBox("pmode", ["1点透視"d, "2点透視"d, "3点透視"d, "アイソメ"d]);
        perspMode.selectedItemIndex = 1;
        perspMode.layoutWidth(FILL_PARENT);
        perspMode.itemClick = delegate(Widget w, int i) {
            persp.mode = cast(PerspMode) i;
            applyPersp(false);
            return true;
        };
        pg.addChild(perspMode);
        labYaw = new TextWidget(null, "水平角 32°"d);
        slYaw = makeSlider("yaw", 0, 70, 32);
        slYaw.scrollEvent = delegate(AbstractSlider s, ScrollEvent e) {
            persp.yawDeg = s.position;
            labYaw.text = to!dstring(format("水平角 %d°", persp.yawDeg));
            applyPersp(false);
            return true;
        };
        pg.addChild(labYaw);
        pg.addChild(slYaw);
        labPitch = new TextWidget(null, "上下角 16°"d);
        slPitch = makeSlider("pitch", -30, 35, 16);
        slPitch.scrollEvent = delegate(AbstractSlider s, ScrollEvent e) {
            persp.pitchDeg = s.position;
            labPitch.text = to!dstring(format("上下角 %d°", persp.pitchDeg));
            applyPersp(false);
            return true;
        };
        pg.addChild(labPitch);
        pg.addChild(slPitch);
        labDist = new TextWidget(null, "距離 55"d);
        slDist = makeSlider("dist", 1, 90, 55);
        slDist.scrollEvent = delegate(AbstractSlider s, ScrollEvent e) {
            persp.dist = s.position;
            labDist.text = to!dstring(format("距離 %d", persp.dist));
            applyPersp(false);
            return true;
        };
        pg.addChild(labDist);
        pg.addChild(slDist);
        labHorizon = new TextWidget(null, "地平線 42%"d);
        slHorizon = makeSlider("hor", 20, 80, 42);
        slHorizon.scrollEvent = delegate(AbstractSlider s, ScrollEvent e) {
            persp.horizonPct = s.position;
            labHorizon.text = to!dstring(format("地平線 %d%%", persp.horizonPct));
            applyPersp(false);
            return true;
        };
        pg.addChild(labHorizon);
        pg.addChild(slHorizon);
        chkGuides = new CheckBox("g", "補助線（地平線・消失点）"d);
        chkGuides.checked = true;
        chkGuides.checkChange = delegate(Widget w, bool c) {
            persp.showGuides = c;
            applyPersp(false);
            return true;
        };
        chkHidden = new CheckBox("h", "隠れ線（薄）"d);
        chkHidden.checked = true;
        chkHidden.checkChange = delegate(Widget w, bool c) {
            persp.showHidden = c;
            applyPersp(false);
            return true;
        };
        pg.addChild(chkGuides);
        pg.addChild(chkHidden);
        pg.addChild(new TextWidget(null, "青い線がお手本。灰色はガイドで採点に入りません。"d).fontSize(12));
        left.addChild(pg);

        left.addChild(new VSpacer());
        left.addChild(new TextWidget(null, "履歴（最近）"d).fontSize(16));
        histList = new StringListWidget("hist");
        histList.layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);
        left.addChild(histList);
        body.addChild(left);

        board = new BoardState();
        board.onChanged = &updateDiagLive;
        sampleView = new BoardView(board, ViewRole.sample, "sample");
        paperView = new BoardView(board, ViewRole.paper, "paper");
        auto canvasFrame = new VerticalLayout();
        canvasFrame.layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);
        canvasFrame.layoutWeight = 3;
        canvasFrame.addChild(new TextWidget(null, "見本（上）— 見て覚える。下には出さない。"d));
        canvasFrame.addChild(sampleView);
        canvasFrame.addChild(new TextWidget(null, "キャンバス（下）— 真っ白な紙に模写する。"d));
        canvasFrame.addChild(paperView);
        body.addChild(canvasFrame);

        auto right = new VerticalLayout();
        right.minWidth = 320;
        right.layoutWidth(360).layoutHeight(FILL_PARENT);
        right.addChild(new TextWidget(null, "答え合わせ"d).fontSize(18));
        overlayCombo = new ComboBox("ovl", [
            "重ね（青=お手本 / 赤=自分 / 緑=一致）"d,
            "差分"d,
            "ヒートマップ"d,
            "スライド比較"d
        ]);
        overlayCombo.selectedItemIndex = 0;
        overlayCombo.itemClick = delegate(Widget w, int i) {
            if (i == 0)
                board.overlay = OverlayMode.overlay;
            else if (i == 1)
                board.overlay = OverlayMode.diff;
            else if (i == 2)
                board.overlay = OverlayMode.heat;
            else
                board.overlay = OverlayMode.wipe;
            refreshBoards();
            return true;
        };
        right.addChild(overlayCombo);
        labWipe = new TextWidget(null, "スライド位置 50%（左=見本 / 右=自分）"d);
        slWipe = makeSlider("wipe", 0, 100, 50);
        slWipe.scrollEvent = delegate(AbstractSlider s, ScrollEvent e) {
            board.wipePct = s.position;
            if (board.wipePct > 100)
                board.wipePct = 100;
            labWipe.text = to!dstring(format("スライド位置 %d%%（左=見本 / 右=自分）", board.wipePct));
            refreshBoards();
            return true;
        };
        right.addChild(labWipe);
        right.addChild(slWipe);
        alignBox = new CheckBox("align", "重心で位置合わせ（形だけ見る）"d);
        alignBox.checkChange = delegate(Widget w, bool checked) {
            board.alignMode = checked ? AlignMode.centroid : AlignMode.none;
            if (board.resultMode)
                refreshDiagnosis();
            refreshBoards();
            return true;
        };
        right.addChild(alignBox);
        diagText = new EditBox("diag");
        diagText.text = "上の見本を見て、下の白い紙に模写します。「答え合わせ」で見本に合成されます。"d;
        diagText.layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);
        diagText.readOnly = true;
        diagText.fontSize(16);
        right.addChild(diagText);
        body.addChild(right);

        addChild(body);
        status = new TextWidget("status", "位置合わせなし。点数は参考です。クセを直す練習です。"d);
        addChild(status);
        reloadHistory();
        selectShape("circle");
        tplList.selectedItemIndex = 1; // 円
    }

    void applyTemplateIndex(int index)
    {
        if (index < 0)
            return;
        if (index < catalog.length)
            selectShape(catalog[index].id);
        else
            loadEmbeddedSample();
    }

    void selectShape(string id)
    {
        templateId = id;
        savedThisResult = false;
        applyPersp(true);
        updateDiagLive();
    }

    void applyPersp(bool clearUser)
    {
        if (board is null)
            return;
        auto r = renderTemplate(templateId, persp);
        board.setTemplate(r.ink, r.guides, clearUser);
        refreshBoards();
        if (isSolidId(templateId))
        {
            static immutable string[] modeName = ["1点", "2点", "3点", "アイソメ"];
            auto mi = cast(int) persp.mode;
            if (mi < 0 || mi > 3)
                mi = 1;
            status.text = to!dstring(format("お手本: %s  パース:%s  水平%d° 地平線%d%%",
                    templateId, modeName[mi], persp.yawDeg, persp.horizonPct));
        }
        else
            status.text = to!dstring("お手本: " ~ templateId ~ "（平面。パースは立体サンプル用）");
    }

    SliderWidget makeSlider(string id, int lo, int hi, int pos)
    {
        auto s = new SliderWidget(id);
        s.orientation = Orientation.Horizontal;
        s.minValue = lo;
        s.pageSize = 8;
        s.maxValue = hi + 8;
        s.position = pos;
        s.layoutWidth(FILL_PARENT);
        s.minHeight = 22;
        s.maxHeight = 28;
        return s;
    }

    void updateDiagLive()
    {
        if (!board.resultMode)
            diagText.text = "下の白い紙に描き、「答え合わせ」で上の見本へ合成します。スライド比較も選べます。"d;
    }

    void refreshBoards()
    {
        if (sampleView)
            sampleView.invalidate();
        if (paperView)
            paperView.invalidate();
    }

    void doCheck()
    {
        board.enterResult();
        refreshDiagnosis();
        refreshBoards();
        savedThisResult = false;
    }

    void refreshDiagnosis()
    {
        auto d = diagnose(board.tpl, board.user, board.strokes, board.alignMode);
        auto m = d.metrics;
        dstring t = to!dstring(format(
                "参考 IoU %.2f\nはみ出し %.0f%%  未到達 %.0f%%\n距離（自分→お手本） %.1f px\n大きさ比 %.2f  ずれ (%.0f, %.0f)\n\n",
                m.iou, m.extraRate * 100, m.missRate * 100,
                m.chamferUserToTpl, m.scaleRatio, m.dx, m.dy));
        foreach (c; d.commentsJa)
            t ~= to!dstring(c) ~ "\n\n"d;
        diagText.text = t;
        status.text = savedThisResult ? "記録済み"d : "未記録 — 「記録」で履歴に残します"d;
    }

    void persist()
    {
        if (!board.resultMode)
        {
            status.text = "先に答え合わせしてください。"d;
            return;
        }
        if (savedThisResult)
        {
            status.text = "この結果は記録済みです。"d;
            return;
        }
        auto d = diagnose(board.tpl, board.user, board.strokes, board.alignMode);
        SessionRecord rec;
        rec.isoTime = nowIso();
        rec.templateId = templateId;
        rec.alignMode = board.alignMode == AlignMode.none ? "none" : "centroid";
        rec.metrics = d.metrics;
        rec.commentsJa = d.commentsJa;
        saveSession(rec);
        savedThisResult = true;
        reloadHistory();
        status.text = "記録しました。"d;
    }

    void reloadHistory()
    {
        recs = loadRecent();
        dstring[] lines;
        foreach_reverse (r; recs)
            lines ~= to!dstring(format("%s  %s  IoU %.2f", r.isoTime, r.templateId, r.metrics.iou));
        if (!lines.length)
            lines = ["（まだ記録がありません）"d];
        histList.items = lines;
    }

    void openFileDlg()
    {
        auto dlg = new FileDialog(UIString.fromRaw("線画 PNG をお手本として開く"d), window, null,
                DialogFlag.Modal | DialogFlag.Resizable | FileDialogFlag.Open);
        dlg.filters = [FileFilterEntry(UIString.fromRaw("PNG 画像"d), "*.png")];
        dlg.dialogResult = delegate(Dialog d, const Action result) {
            if (result.id != StandardAction.Open)
                return;
            auto fd = cast(FileDialog) d;
            openImagePath(fd.filename);
        };
        dlg.show();
    }

    void openImagePath(string path)
    {
        import std.file : exists;
        if (!exists(path))
        {
            status.text = to!dstring("ファイルがありません: " ~ path);
            return;
        }
        auto img = loadImage(path);
        if (img is null)
        {
            status.text = "画像を読めませんでした。"d;
            return;
        }
        board.setTemplate(maskFromImage(img), Mask(CanvasSize, CanvasSize), true);
        refreshBoards();
        templateId = "image:" ~ path;
        savedThisResult = false;
        status.text = to!dstring("お手本: " ~ path);
        updateDiagLive();
    }

    void loadEmbeddedSample()
    {
        auto data = cast(immutable(ubyte)[]) import("sample_house.png");
        auto img = loadImage(data, "sample_house.png");
        if (img is null)
        {
            status.text = "サンプル画像を読めませんでした。"d;
            return;
        }
        board.setTemplate(maskFromImage(img), Mask(CanvasSize, CanvasSize), true);
        refreshBoards();
        templateId = "image:sample_house";
        savedThisResult = false;
        status.text = "お手本: サンプル家型（線画）"d;
        updateDiagLive();
    }
}

Mask maskFromImage(ColorDrawBuf img)
{
    auto rgba = new ubyte[](CanvasSize * CanvasSize * 4);
    foreach (y; 0 .. CanvasSize)
    {
        int sy = y * img.height / CanvasSize;
        if (sy < 0)
            sy = 0;
        if (sy >= img.height)
            sy = img.height - 1;
        uint* sl = img.scanLine(sy);
        foreach (x; 0 .. CanvasSize)
        {
            int sx = x * img.width / CanvasSize;
            if (sx < 0)
                sx = 0;
            if (sx >= img.width)
                sx = img.width - 1;
            uint p = sl[sx];
            ubyte r = cast(ubyte)((p >> 16) & 0xFF);
            ubyte g = cast(ubyte)((p >> 8) & 0xFF);
            ubyte b = cast(ubyte)(p & 0xFF);
            size_t o = (y * CanvasSize + x) * 4;
            rgba[o] = r;
            rgba[o + 1] = g;
            rgba[o + 2] = b;
            rgba[o + 3] = 255;
        }
    }
    return fromRgbaInk(rgba, CanvasSize, CanvasSize);
}
