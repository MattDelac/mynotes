package com.mdelacour.mynotes.ui.editor

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp

@Composable
fun TaskPanel(
	tasks: List<TaskItem>,
	readOnly: Boolean,
	onToggle: (TaskItem) -> Unit,
	modifier: Modifier = Modifier,
) {
	Surface(
		modifier = modifier.fillMaxWidth(),
		color = MaterialTheme.colorScheme.surfaceVariant,
		contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
		tonalElevation = 2.dp,
	) {
		Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
			for (task in tasks) {
				Row(
					modifier = Modifier
						.fillMaxWidth()
						.toggleable(
							value = task.checked,
							enabled = !readOnly,
							role = Role.Checkbox,
							onValueChange = { onToggle(task) },
						)
						.padding(horizontal = 12.dp, vertical = 4.dp),
					verticalAlignment = Alignment.CenterVertically,
				) {
					Checkbox(
						checked = task.checked,
						onCheckedChange = null,
						enabled = !readOnly,
					)
					Text(
						text = task.text.ifBlank { "(empty task)" },
						style = MaterialTheme.typography.bodyMedium,
						color = if (task.checked) {
							MaterialTheme.colorScheme.onSurfaceVariant
						} else {
							MaterialTheme.colorScheme.onSurface
						},
						textDecoration = if (task.checked) TextDecoration.LineThrough else null,
						modifier = Modifier.padding(start = 8.dp),
					)
				}
			}
		}
	}
}
