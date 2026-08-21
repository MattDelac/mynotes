import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { putBlob } from './db';
import { altFromFileName, MAX_IMAGE_BYTES, mynotesRef, processImageFile } from './images';
import { showToast } from './toast';

function imageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
	if (!dataTransfer) return [];
	const direct = Array.from(dataTransfer.files).filter((file) => file.type.startsWith('image/'));
	if (direct.length > 0) return direct;
	return Array.from(dataTransfer.items ?? [])
		.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
}

function lineBreaks(state: EditorState, pos: number): { prefix: string; suffix: string } {
	const line = state.doc.lineAt(pos);
	const before = line.text.slice(0, pos - line.from);
	const after = line.text.slice(pos - line.from);
	return { prefix: before ? '\n' : '', suffix: after ? '\n' : '' };
}

async function insertImages(view: EditorView, files: File[]): Promise<void> {
	let pos = view.state.selection.main.from;
	for (const file of files) {
		try {
			const image = await processImageFile(file);
			if (image.data.byteLength > MAX_IMAGE_BYTES) {
				showToast('danger', 'Image too large');
				continue;
			}
			const id = crypto.randomUUID();
			await putBlob({
				id,
				data: image.data,
				type: image.type,
				width: image.width,
				height: image.height,
				createdAt: Date.now()
			});
			const { prefix, suffix } = lineBreaks(view.state, pos);
			const text = prefix + mynotesRef(id, altFromFileName(file.name)) + suffix;
			view.dispatch({
				changes: { from: pos, insert: text },
				selection: { anchor: pos + text.length }
			});
			pos += text.length;
		} catch {
			showToast('danger', 'Could not insert image');
		}
	}
}

function isEditable(view: EditorView): boolean {
	return view.state.facet(EditorView.editable);
}

export const imagePasteDrop = EditorView.domEventHandlers({
	paste(event: ClipboardEvent, view: EditorView) {
		if (!isEditable(view)) return false;
		const files = imageFilesFromDataTransfer(event.clipboardData);
		if (files.length === 0) return false;
		event.preventDefault();
		void insertImages(view, files);
		return true;
	},
	dragover(event: DragEvent) {
		if (event.dataTransfer?.types.includes('Files')) {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
		}
		return false;
	},
	drop(event: DragEvent, view: EditorView) {
		if (!isEditable(view)) return false;
		const files = imageFilesFromDataTransfer(event.dataTransfer);
		if (files.length === 0) return false;
		event.preventDefault();
		void insertImages(view, files);
		return true;
	}
});
