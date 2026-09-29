pipeline {
  agent any

  tools { nodejs 'node-v22' }

  parameters {
    booleanParam(name: 'IMPORT_INITIAL_USERS', defaultValue: false, description: 'Importar tbusuario.sql una sola vez a la base V2')
  }

  stages {
    stage('Install and build') {
      steps {
        withCredentials([file(credentialsId: 'CONTROL_ANULADOS_V2_ENV', variable: 'V2_ENV_FILE')]) {
          sh 'cp "$V2_ENV_FILE" .env'
        }
        dir('frontend') {
          sh 'npm install --no-audit --no-fund'
          sh 'npm run build'
        }
        dir('api') {
          sh 'npm install --no-audit --no-fund'
          sh 'npm run build'
        }
      }
    }

    stage('Deploy') {
      steps {
        sh 'docker compose up -d --build --remove-orphans'
      }
    }

    stage('Initialize users (optional)') {
      when { expression { return params.IMPORT_INITIAL_USERS == true } }
      steps {
        withCredentials([file(credentialsId: 'CONTROL_ANULADOS_USERS_SQL', variable: 'USERS_SQL')]) {
          sh 'docker compose run --rm --no-deps -v "$USERS_SQL:/run/secrets/tbusuario.sql:ro" api npm run import-users -- /run/secrets/tbusuario.sql'
        }
      }
    }
  }

  post {
    always { sh 'rm -f .env' }
  }
}