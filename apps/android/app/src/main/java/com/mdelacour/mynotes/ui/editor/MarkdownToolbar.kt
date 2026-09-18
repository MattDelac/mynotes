package com.mdelacour.mynotes.ui.editor

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.DataObject
import androidx.compose.material.icons.outlined.FormatBold
import androidx.compose.material.icons.outlined.FormatItalic
import androidx.compose.material.icons.outlined.FormatListNumbered
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.FormatStrikethrough
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Looks3
import androidx.compose.material.icons.outlined.LooksOne
import androidx.compose.material.icons.outlined.LooksTwo
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

@Composable
fun MarkdownToolbar(
	enabled: Boolean,
	onAction: (MarkdownAction) -> Unit,
	modifier: Modifier = Modifier,
) {
	Row(
		modifier = modifier
			.horizontalScroll(rememberScrollState())
			.padding(horizontal = 4.dp),
	) {
		for (item in MARKDOWN_TOOLBAR_ITEMS) {
			IconButton(
				onClick = { onAction(item.action) },
				enabled = enabled,
			) {
				Icon(imageVector = item.icon, contentDescription = item.action.contentDescription)
			}
		}
	}
}

private data class ToolbarItem(val action: MarkdownAction, val icon: ImageVector)

private val MARKDOWN_TOOLBAR_ITEMS = listOf(
	ToolbarItem(MarkdownAction.HEADING_1, Icons.Outlined.LooksOne),
	ToolbarItem(MarkdownAction.HEADING_2, Icons.Outlined.LooksTwo),
	ToolbarItem(MarkdownAction.HEADING_3, Icons.Outlined.Looks3),
	ToolbarItem(MarkdownAction.BOLD, Icons.Outlined.FormatBold),
	ToolbarItem(MarkdownAction.ITALIC, Icons.Outlined.FormatItalic),
	ToolbarItem(MarkdownAction.STRIKETHROUGH, Icons.Outlined.FormatStrikethrough),
	ToolbarItem(MarkdownAction.INLINE_CODE, Icons.Outlined.Code),
	ToolbarItem(MarkdownAction.LINK, Icons.Outlined.Link),
	ToolbarItem(MarkdownAction.UNORDERED_LIST, Icons.AutoMirrored.Outlined.FormatListBulleted),
	ToolbarItem(MarkdownAction.ORDERED_LIST, Icons.Outlined.FormatListNumbered),
	ToolbarItem(MarkdownAction.TASK_LIST, Icons.Outlined.Checklist),
	ToolbarItem(MarkdownAction.BLOCKQUOTE, Icons.Outlined.FormatQuote),
	ToolbarItem(MarkdownAction.FENCED_CODE, Icons.Outlined.DataObject),
)
