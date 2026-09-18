package com.mdelacour.mynotes.ui.sessions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.mdelacour.mynotes.R

@Composable
fun SessionListScreen() {
	Scaffold { padding ->
		Column(
			modifier = Modifier
				.fillMaxSize()
				.padding(padding)
				.padding(24.dp),
			verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
			horizontalAlignment = Alignment.CenterHorizontally,
		) {
			Text(
				text = stringResource(R.string.app_name),
				style = MaterialTheme.typography.headlineMedium,
			)
		}
	}
}
