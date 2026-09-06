module engine.session;

import engine.board;
import engine.raster;
import engine.types;
import engine.templates;
import engine.solids;
import engine.diagnose;
import engine.perspective;
import store.history;

/// Shared application commands. Widgets and regression scenarios use this same state.
class PracticeSession
{
    BoardState board;
    string templateId = "circle";
    PerspSettings perspective;
    bool saved;
    ulong peekGeneration;
    void delegate(SessionRecord) writeRecord;
    string delegate() timestamp;

    this()
    {
        board = new BoardState();
        writeRecord = (SessionRecord record) { saveSession(record); };
        timestamp = () { return nowIso(); };
    }

    void stopPeek()
    {
        ++peekGeneration;
        board.peeking = false;
    }

    ulong peek()
    {
        board.peeking = board.memoryMode;
        return ++peekGeneration;
    }

    void expirePeek(ulong generation)
    {
        if (generation == peekGeneration) board.peeking = false;
    }

    void memory(bool enabled)
    {
        stopPeek();
        board.memoryMode = enabled;
    }

    void select(string id)
    {
        auto rendered = renderTemplate(id, perspective);
        setTemplate(id, rendered.ink, rendered.guides);
    }

    void setTemplate(string id, Mask ink, Mask guides, ubyte[] color = null)
    {
        stopPeek();
        templateId = id;
        board.setTemplate(ink, guides, true, color);
        saved = false;
    }

    void adjustPerspective(PerspSettings settings)
    {
        perspective = settings;
        if (!isSolidId(templateId)) return;
        auto rendered = renderTemplate(templateId, perspective);
        if (rendered.ink.px == board.tpl.px)
        {
            board.guides = rendered.guides;
            return;
        }
        board.setTemplate(rendered.ink, rendered.guides, false);
        saved = false;
    }

    void clear() { board.clearInk(); saved = false; }
    void undo() { board.undo(); saved = false; }
    void check()
    {
        // Rechecking an unchanged result must not allow duplicate records.
        if (!board.resultMode) { board.enterResult(); saved = false; }
    }

    void setAlignment(AlignMode mode)
    {
        if (board.alignMode != mode) saved = false;
        board.alignMode = mode;
    }

    bool save()
    {
        if (!board.resultMode || saved) return false;
        auto result = diagnose(board.tpl, board.user, board.strokes, board.alignMode);
        SessionRecord record;
        record.isoTime = timestamp();
        record.templateId = templateId;
        record.alignMode = board.alignMode == AlignMode.none ? "none" : "centroid";
        record.metrics = result.metrics;
        record.commentsJa = result.commentsJa;
        writeRecord(record); // Only mark saved after a successful write.
        saved = true;
        return true;
    }
}
