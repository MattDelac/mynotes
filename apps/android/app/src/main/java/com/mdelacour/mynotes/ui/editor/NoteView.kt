package com.mdelacour.mynotes.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp

@Composable
fun NoteView(
	blocks: List<NoteBlock>,
	readOnly: Boolean,
	onToggleTask: (TaskItem) -> Unit,
	modifier: Modifier = Modifier,
) {
	Surface(
		modifier = modifier.fillMaxSize(),
		color = MaterialTheme.colorScheme.background,
		contentColor = MaterialTheme.colorScheme.onBackground,
	) {
		LazyColumn(
			modifier = Modifier.fillMaxSize(),
			contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
		) {
			items(blocks) { block ->
				NoteBlockRow(
					block = block,
					readOnly = readOnly,
					onToggleTask = onToggleTask,
				)
			}
		}
	}
}

@Composable
private fun NoteBlockRow(
	block: NoteBlock,
	readOnly: Boolean,
	onToggleTask: (TaskItem) -> Unit,
) {
	when (block) {
		is NoteBlock.Heading -> HeadingRow(block)
		is NoteBlock.Task -> TaskRow(block.item, readOnly, onToggleTask)
		is NoteBlock.Bullet -> IndentedText("•", block.text, block.indent)
		is NoteBlock.OrderedItem -> IndentedText(block.marker, block.text, block.indent)
		is NoteBlock.Quote -> QuoteRow(block.text)
		is NoteBlock.CodeLine -> CodeRow(block.text)
		is NoteBlock.Paragraph -> Text(
			text = block.text,
			style = MaterialTheme.typography.bodyLarge,
		)

		NoteBlock.Blank -> Spacer(modifier = Modifier.height(8.dp))
	}
}

@Composable
private fun HeadingRow(heading: NoteBlock.Heading) {
	val style = when (heading.level) {
		1 -> MaterialTheme.typography.headlineMedium
		2 -> MaterialTheme.typography.headlineSmall
		3 -> MaterialTheme.typography.titleLarge
		else -> MaterialTheme.typography.titleMedium
	}
	Text(
		text = heading.text.ifEmpty { "\u00A0" },
		style = style,
		fontWeight = FontWeight.Bold,
		color = if (heading.level >= 4) {
			MaterialTheme.colorScheme.onSurfaceVariant
		} else {
			MaterialTheme.colorScheme.onSurface
		},
		modifier = Modifier
			.fillMaxWidth()
			.padding(top = 16.dp, bottom = 4.dp),
	)
}

@Composable
private fun TaskRow(
	item: TaskItem,
	readOnly: Boolean,
	onToggleTask: (TaskItem) -> Unit,
) {
	Row(
		modifier = Modifier
			.fillMaxWidth()
			.padding(start = (item.indent * 16).dp)
			.toggleable(
				value = item.checked,
				enabled = !readOnly,
				role = Role.Checkbox,
				onValueChange = { onToggleTask(item) },
			)
			.padding(vertical = 2.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		Checkbox(
			checked = item.checked,
			onCheckedChange = null,
			enabled = !readOnly,
		)
		Text(
			text = item.text.ifEmpty { "(empty task)" },
			style = MaterialTheme.typography.bodyLarge,
			color = if (item.checked) {
				MaterialTheme.colorScheme.onSurfaceVariant
			} else {
				MaterialTheme.colorScheme.onSurface
			},
			textDecoration = if (item.checked) TextDecoration.LineThrough else null,
			modifier = Modifier.padding(start = 8.dp),
		)
	}
}

@Composable
private fun IndentedText(marker: String, text: String, indent: Int) {
	Row(
		modifier = Modifier
			.fillMaxWidth()
			.padding(start = (indent * 16).dp, top = 2.dp, bottom = 2.dp),
	) {
		Text(text = marker, style = MaterialTheme.typography.bodyLarge)
		Text(
			text = text.ifEmpty { "\u00A0" },
			style = MaterialTheme.typography.bodyLarge,
			modifier = Modifier.padding(start = 8.dp),
		)
	}
}

@Composable
private fun QuoteRow(text: String) {
	Row(
		modifier = Modifier
			.fillMaxWidth()
			.height(IntrinsicSize.Min)
			.padding(vertical = 2.dp),
	) {
		Box(
			modifier = Modifier
				.width(3.dp)
				.fillMaxHeight()
				.background(MaterialTheme.colorScheme.primary),
		)
		Text(
			text = text.ifEmpty { "\u00A0" },
			style = MaterialTheme.typography.bodyLarge,
			fontStyle = FontStyle.Italic,
			color = MaterialTheme.colorScheme.onSurfaceVariant,
			modifier = Modifier.padding(start = 8.dp, top = 2.dp, bottom = 2.dp),
		)
	}
}

@Composable
private fun CodeRow(text: String) {
	Text(
		text = text.ifEmpty { "\u00A0" },
		style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
		color = MaterialTheme.colorScheme.onSurfaceVariant,
		modifier = Modifier
			.fillMaxWidth()
			.background(MaterialTheme.colorScheme.surfaceVariant)
			.padding(horizontal = 8.dp, vertical = 2.dp),
	)
}
